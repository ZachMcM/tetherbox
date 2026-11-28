import * as React from "react"
import { cn } from "cn"

type BuddyShape = "circle" | "squircle" | "triangle"
type BuddyColor =
  | "coral"
  | "amber"
  | "lime"
  | "mint"
  | "sky"
  | "iris"
  | "rose"
  | "stone"
type BuddyGaze = "ahead" | "left" | "right" | "up" | "up-right" | "down"

interface BuddyLook {
  shape: BuddyShape
  color: BuddyColor
  gaze: BuddyGaze
}

type Point = readonly [number, number]

function polygonVertices(sides: number, center: Point, radius: number, rotation: number): Point[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index * 2 * Math.PI) / sides
    return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)] as const
  })
}

function roundedPolygonPath(vertices: readonly Point[], cornerRadius: number): string {
  const [first, second] = vertices
  if (first === undefined || second === undefined) return ""

  const t = cornerRadius / Math.hypot(second[0] - first[0], second[1] - first[1])
  const lerp = (a: Point, b: Point): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  const fmt = (p: Point) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`

  const segments = vertices.map((vertex, index) => {
    const prev = vertices[(index - 1 + vertices.length) % vertices.length] ?? vertex
    const next = vertices[(index + 1) % vertices.length] ?? vertex
    return `${index === 0 ? "M" : "L"}${fmt(lerp(vertex, prev))}Q${fmt(vertex)} ${fmt(lerp(vertex, next))}`
  })

  return `${segments.join("")}Z`
}

/** Signed distance to a convex polygon's edges, negative inside. */
function polygonDistance(vertices: readonly Point[], center: Point) {
  const edges = vertices.map((p, index) => {
    const q = vertices[(index + 1) % vertices.length] ?? p
    const length = Math.hypot(q[0] - p[0], q[1] - p[1])
    let nx = (q[1] - p[1]) / length
    let ny = -(q[0] - p[0]) / length
    if ((center[0] - p[0]) * nx + (center[1] - p[1]) * ny > 0) {
      nx = -nx
      ny = -ny
    }
    return { p, nx, ny }
  })

  return (x: number, y: number) =>
    Math.max(...edges.map((edge) => (x - edge.p[0]) * edge.nx + (y - edge.p[1]) * edge.ny))
}

function roundRectDistance(center: Point, half: number, radius: number, degrees: number) {
  const angle = (degrees * Math.PI) / 180
  return (x: number, y: number) => {
    const dx = x - center[0]
    const dy = y - center[1]
    const qx = Math.abs(dx * Math.cos(angle) - dy * Math.sin(angle)) - (half - radius)
    const qy = Math.abs(dx * Math.sin(angle) + dy * Math.cos(angle)) - (half - radius)
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
  }
}

interface ShapeGeometry {
  body: React.ReactNode
  face: Point
  spread: number
  highlight: Point
  distance: (x: number, y: number) => number
}

const triangleVertices = polygonVertices(3, [12, 13.8], 12.4, -Math.PI / 2)

const SHAPES: Record<BuddyShape, ShapeGeometry> = {
  circle: {
    body: <circle cx="12" cy="12" r="9.8" />,
    face: [12, 11.4],
    spread: 3.6,
    highlight: [7.9, 6.7],
    distance: (x, y) => Math.hypot(x - 12, y - 12) - 9.8,
  },
  squircle: {
    body: (
      <rect x="2.8" y="2.8" width="18.4" height="18.4" rx="7" transform="rotate(-10 12 12)" />
    ),
    face: [12, 11.6],
    spread: 3.6,
    highlight: [7.4, 7],
    distance: roundRectDistance([12, 12], 9.2, 7, 10),
  },
  triangle: {
    body: <path d={roundedPolygonPath(triangleVertices, 4.4)} />,
    face: [12, 14.2],
    spread: 3.2,
    highlight: [10.2, 8],
    distance: polygonDistance(triangleVertices, [12, 13.8]),
  },
}

const GAZES: Record<BuddyGaze, Point> = {
  ahead: [0, 0],
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  "up-right": [0.75, -0.75],
  down: [0, 1],
}

const EYE_MARGIN = 2.2

function eyePositions({
  geometry,
  gaze,
  half,
  lean,
  strokeWidth,
}: {
  geometry: ShapeGeometry
  gaze: Point
  half: number
  lean: number
  strokeWidth: number
}): Point[] {
  const [fx, fy] = geometry.face
  const place = (k: number): Point[] =>
    [-1, 1].map(
      (side) => [fx + (side * geometry.spread) / 2 + gaze[0] * 2.4 * k, fy + gaze[1] * 2 * k] as const
    )
  const clearance = -(strokeWidth / 2 + EYE_MARGIN)
  const fits = (k: number) =>
    place(k).every(
      ([x, y]) =>
        geometry.distance(x - lean / 2, y - half) <= clearance &&
        geometry.distance(x + lean / 2, y + half) <= clearance
    )

  if (fits(1)) return place(1)

  let low = 0
  let high = 1
  for (let step = 0; step < 10; step++) {
    const mid = (low + high) / 2
    if (fits(mid)) low = mid
    else high = mid
  }
  return place(low)
}

function animationOffset(look: BuddyLook, salt: number): string {
  let hash = salt
  for (const char of `${look.shape}${look.color}${look.gaze}`) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return `-${(hash % 90) / 10}s`
}

function Buddy({
  shape,
  color,
  gaze,
  size = 16,
  animated = true,
  className,
  style,
  ...props
}: BuddyLook & {
  size?: number
  animated?: boolean
} & Omit<React.ComponentProps<"svg">, "color">) {
  const id = React.useId()
  const geometry = SHAPES[shape]
  const small = size < 24
  const half = small ? 1.25 : 1.1
  const strokeWidth = small ? 2.1 : 1.75
  const gazeVector = GAZES[gaze]
  const lean = 0.5 + gazeVector[0] * 0.45
  const eyes = eyePositions({ geometry, gaze: gazeVector, half, lean, strokeWidth })
  const fill = `var(--buddy-${color})`
  const [hx, hy] = geometry.highlight
  const shineX = hx - gazeVector[0] * 0.5

  return (
    <svg
      data-slot="buddy"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("shrink-0 overflow-visible", className)}
      style={{ width: size, height: size, ...style }}
      {...props}
    >
      <defs>
        <radialGradient id={`${id}-fill`} cx="0.34" cy="0.28" r="0.9">
          <stop offset="0" style={{ stopColor: `color-mix(in oklch, ${fill}, white 55%)` }} />
          <stop offset="0.42" style={{ stopColor: fill }} />
          <stop offset="1" style={{ stopColor: `color-mix(in oklch, ${fill}, black 42%)` }} />
        </radialGradient>
        <linearGradient id={`${id}-bounce`} x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0"
            stopOpacity="0"
            style={{ stopColor: `color-mix(in oklch, ${fill}, white 40%)` }}
          />
          <stop
            offset="1"
            stopOpacity="0.7"
            style={{ stopColor: `color-mix(in oklch, ${fill}, white 40%)` }}
          />
        </linearGradient>
        <radialGradient id={`${id}-shadow`}>
          <stop offset="0" stopColor="black" stopOpacity="0.3" />
          <stop offset="1" stopColor="black" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>{geometry.body}</clipPath>
      </defs>
      {size >= 28 && (
        <ellipse cx="12" cy="22.8" rx="8.5" ry="1.7" fill={`url(#${id}-shadow)`} />
      )}
      <g className="buddy-body">
        <g fill={`url(#${id}-fill)`}>{geometry.body}</g>
        <g clipPath={`url(#${id}-clip)`}>
          <ellipse cx="12" cy="22.4" rx="9" ry="3.4" fill={`url(#${id}-bounce)`} />
          <ellipse
            cx={shineX}
            cy={hy}
            rx="3"
            ry="1.55"
            fill="white"
            opacity="0.75"
            transform={`rotate(-30 ${hx} ${hy})`}
          />
          <circle cx={shineX + 3.2} cy={hy - 1.6} r="0.65" fill="white" opacity="0.6" />
        </g>
        <g
          className={animated ? "buddy-look" : undefined}
          style={{ animationDelay: animationOffset({ shape, color, gaze }, 7) }}
        >
          <g
            className={animated ? "buddy-blink" : undefined}
            style={{ animationDelay: animationOffset({ shape, color, gaze }, 13) }}
            stroke="var(--buddy-eye)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          >
            {eyes.map(([x, y]) => (
              <line
                key={x}
                x1={x - lean / 2}
                y1={y - half}
                x2={x + lean / 2}
                y2={y + half}
              />
            ))}
            {size >= 20 &&
              eyes.map(([x, y]) => (
                <circle
                  key={`glint-${x}`}
                  cx={x - lean / 2 + 0.15}
                  cy={y - half + 0.2}
                  r="0.45"
                  fill="white"
                  stroke="none"
                />
              ))}
          </g>
        </g>
      </g>
    </svg>
  )
}

export { Buddy }
