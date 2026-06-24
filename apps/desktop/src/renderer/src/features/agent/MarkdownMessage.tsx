import { Component, type ErrorInfo, type ReactNode } from "react";
import MarkdownMessageRenderer from "./MarkdownMessageRenderer";

type MarkdownMessageProps = {
  className?: string | undefined;
  content: string;
  streaming?: boolean;
};

export function MarkdownMessage({ className, content, streaming = false }: MarkdownMessageProps) {
  return (
    <MarkdownMessageErrorBoundary content={content}>
      <MarkdownMessageRenderer className={className} content={content} streaming={streaming} />
    </MarkdownMessageErrorBoundary>
  );
}

function PlainTextFallback({ content }: { content: string }) {
  return <div className="whitespace-pre-wrap text-fg">{content}</div>;
}

class MarkdownMessageErrorBoundary extends Component<
  { children: ReactNode; content: string },
  { error: Error | undefined }
> {
  override state = { error: undefined };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidUpdate(previousProps: { content: string }) {
    if (this.state.error && previousProps.content !== this.props.content) {
      this.setState({ error: undefined });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Markdown render failed.", error, info);
  }

  override render() {
    if (this.state.error) {
      return <PlainTextFallback content={this.props.content} />;
    }

    return this.props.children;
  }
}
