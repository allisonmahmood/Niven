import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

interface MarkdownBlockProps {
  readonly className?: string;
  readonly text: string;
}

function normalizeInlineListLine(line: string): string {
  const marker = ": - ";
  const markerIndex = line.indexOf(marker);

  if (markerIndex === -1) {
    return line;
  }

  const prefix = line.slice(0, markerIndex + 1);
  const suffix = line.slice(markerIndex + marker.length).trim();

  return `${prefix}\n- ${suffix.replace(/\s+-\s+/g, "\n- ")}`;
}

export function normalizeChatMarkdown(text: string): string {
  return text.replace(/\r\n?/g, "\n").split("\n").map(normalizeInlineListLine).join("\n").trim();
}

export function MarkdownBlock(props: MarkdownBlockProps) {
  const className = props.className ? `markdown-block ${props.className}` : "markdown-block";

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
        {normalizeChatMarkdown(props.text)}
      </ReactMarkdown>
    </div>
  );
}
