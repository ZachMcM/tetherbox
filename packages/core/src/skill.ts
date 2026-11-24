import { z } from "zod";

export const skillFrontmatterSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  description: z.string().min(1),
});
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;
