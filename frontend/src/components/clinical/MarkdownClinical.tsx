import type { Components } from "react-markdown"
import Markdown from "react-markdown"

import { cn } from "@/lib/utils"

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 text-lg font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 text-base font-semibold text-foreground first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="leading-relaxed text-foreground/95">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 text-foreground/95">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 text-foreground/95">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-lg border border-border/60 bg-muted/60 p-3 text-[0.85rem]">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-primary/25 border-l-4 py-0.5 pl-4 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/50 text-left">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="border-border/60 border px-3 py-2 font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-border/60 border px-3 py-2">{children}</td>
  ),
}

export function MarkdownClinical({
  markdown,
  className,
}: {
  markdown: string
  className?: string
}) {
  try {
    return (
      <div className={cn("space-y-2 text-sm text-foreground", className)}>
        <Markdown components={components}>{markdown}</Markdown>
      </div>
    )
  } catch {
    return (
      <div
        className={cn(
          "rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive",
          className,
        )}
      >
        Unable to render summary. Please try regenerating.
      </div>
    )
  }
}
