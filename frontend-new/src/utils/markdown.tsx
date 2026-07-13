import { markdownToHTML } from "./markdownHtml";

export function MarkdownContent({ content, className = "" }: { content: string; className?: string }) {
  return (
    <div
      className={`markdown-content ${className}`}
      dangerouslySetInnerHTML={{ __html: markdownToHTML(content) }}
    />
  );
}
