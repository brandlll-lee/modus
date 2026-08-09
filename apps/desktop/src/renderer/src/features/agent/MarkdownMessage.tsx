import {
  Component,
  type ErrorInfo,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { MarkdownFileNavContext } from "./markdownFileNav";

const MarkdownMessageRenderer = lazy(() => import("./MarkdownMessageRenderer"));
const REVEAL_WINDOW_MS = 120;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function nextStreamingIndex(text: string, index: number, elapsed: number): number {
  const backlog = text.length - index;
  if (backlog <= 0) return text.length;
  const share = Math.min(1, Math.max(0, elapsed) / REVEAL_WINDOW_MS);
  const target = index + Math.max(1, Math.ceil(backlog * share));
  if (target >= text.length) return text.length;
  const segment = graphemes.segment(text).containing(target - 1);
  return segment ? segment.index + segment.segment.length : target;
}

type MarkdownMessageProps = {
  className?: string | undefined;
  content: string;
  streaming?: boolean;
  cwd?: string | undefined;
  onOpenFile?: ((path: string) => void) | undefined;
};

export function MarkdownMessage({
  className,
  content,
  streaming = false,
  cwd,
  onOpenFile,
}: MarkdownMessageProps) {
  const [shown, animating] = useStreamingPresentation(content, streaming);
  return (
    <MarkdownFileNavContext.Provider value={{ cwd, onOpenFile }}>
      <MarkdownMessageErrorBoundary content={shown}>
        <Suspense fallback={<PlainTextFallback content={shown} />}>
          <MarkdownMessageRenderer className={className} content={shown} streaming={animating} />
        </Suspense>
      </MarkdownMessageErrorBoundary>
    </MarkdownFileNavContext.Provider>
  );
}

function useStreamingPresentation(content: string, streaming: boolean): readonly [string, boolean] {
  const liveRef = useRef(streaming);
  liveRef.current ||= streaming;
  const [visible, setVisible] = useState(() =>
    streaming ? content.slice(0, nextStreamingIndex(content, 0, 0)) : content,
  );
  const contentRef = useRef(content);
  const indexRef = useRef(visible.length);
  contentRef.current = content;
  if (!liveRef.current) indexRef.current = content.length;
  const pending = liveRef.current && visible !== content;

  useEffect(() => {
    if (!streaming && !pending) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (timestamp: number): void => {
      const full = contentRef.current;
      const index = Math.min(indexRef.current, full.length);
      const end = nextStreamingIndex(full, index, timestamp - previous);
      indexRef.current = end;
      previous = timestamp;
      if (end !== index) setVisible(full.slice(0, end));
      if (streaming || end < contentRef.current.length) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [streaming, pending]);

  return [liveRef.current ? visible : content, streaming || pending] as const;
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
