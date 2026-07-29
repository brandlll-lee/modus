//! Streaming decode of ConPTY/PTY bytes into UTF-8 strings.
//!
//! Microsoft documents that Pseudoconsole I/O streams are **always UTF-8**
//! (including VT). The host must consume the pipe as UTF-8; guessing the ANSI
//! code page (`GetACP`) is the wrong contract and produces classic mojibake
//! when UTF-8 TUIs (box-drawing, CJK) run under ConPTY on localized Windows.
//!
//! Session console CP (65001) is set by the shell spawn prelude on the
//! TypeScript side — ConPTY cannot inherit that from the parent. This decoder
//! only handles the pipe side: identity UTF-8 with carry across chunk splits.

use encoding_rs::{Decoder, UTF_8};

/// Streaming byte→UTF-8 decoder for one PTY session.
pub struct PtyDecoder {
    decoder: Decoder,
}

impl PtyDecoder {
    /// Create a decoder for one PTY session.
    ///
    /// `encoding` is accepted for protocol compatibility with older hosts; the
    /// ConPTY pipe is UTF-8 regardless, so every session uses UTF-8.
    pub fn new(_encoding: Option<&str>) -> Self {
        Self {
            decoder: UTF_8.new_decoder(),
        }
    }

    /// Decode one chunk of PTY bytes. Any incomplete trailing multi-byte
    /// sequence is retained internally and completed by the next `push`.
    pub fn push(&mut self, bytes: &[u8]) -> String {
        let mut out = String::with_capacity(bytes.len() + 8);
        let _ = self.decoder.decode_to_string(bytes, &mut out, false);
        out
    }

    /// Flush any buffered partial sequence when the stream ends (process exit).
    pub fn finish(&mut self) -> String {
        let mut out = String::new();
        let _ = self.decoder.decode_to_string(&[], &mut out, true);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8_passthrough() {
        let mut d = PtyDecoder::new(None);
        assert_eq!(d.push("hello 世界".as_bytes()), "hello 世界");
        assert_eq!(d.finish(), "");
    }

    #[test]
    fn rejoins_a_multibyte_char_split_across_reads() {
        // "世" is E4 B8 96 in UTF-8; feed it one byte at a time.
        let bytes = "世".as_bytes().to_vec();
        let mut d = PtyDecoder::new(Some("utf-8"));
        let mut out = String::new();
        out.push_str(&d.push(&bytes[0..1]));
        out.push_str(&d.push(&bytes[1..2]));
        out.push_str(&d.push(&bytes[2..3]));
        out.push_str(&d.finish());
        assert_eq!(out, "世");
    }

    #[test]
    fn treats_box_drawing_as_utf8_not_legacy_bytes() {
        // U+2500 BOX DRAWINGS LIGHT HORIZONTAL — the glyph Codex TUIs emit.
        let mut d = PtyDecoder::new(None);
        assert_eq!(d.push("─│┌".as_bytes()), "─│┌");
    }
}
