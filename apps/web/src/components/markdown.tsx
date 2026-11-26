import { isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@tetherbox/ui/components/code-block";
import { useHighlightedCode } from "@tetherbox/ui/hooks/use-highlighted-code";

function HighlightedFence({ code, language }: { code: string; language: string }) {
  const lines = useHighlightedCode(code, language);

  return (
    <CodeBlock size="sm" className="my-2">
      <CodeBlockHeader>
        <CodeBlockTitle>{language || "text"}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

function extractFence(children: ReactNode): { code: string; language: string } | undefined {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) {
    return undefined;
  }

  const className = children.props.className ?? "";
  const match = /language-([^\s]+)/.exec(className);
  const raw = children.props.children;
  const code = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join("") : "";

  return { code, language: match?.[1] ?? "text" };
}

export function Markdown({ content }: { content: string }) {
  return (
    <div className="min-w-0 space-y-2.5 text-sm leading-relaxed wrap-break-word [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p]:leading-relaxed [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            const fence = extractFence(children);

            if (fence === undefined) {
              return <pre>{children}</pre>;
            }

            return <HighlightedFence code={fence.code} language={fence.language} />;
          },
          code({ node: _node, className, children, ...props }) {
            return (
              <code
                className={
                  className ?? "rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
                }
                {...props}
              >
                {children}
              </code>
            );
          },
          a({ node: _node, href, children, ...props }) {
            return (
              <a href={href} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
