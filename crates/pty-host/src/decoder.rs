//! Code-page-aware streaming decode of raw PTY bytes into UTF-8.
//!
//! Child programs write their output in the host's *console code page*: UTF-8
//! on modern/Unix systems, but a legacy code page on localized Windows — GBK
//! (936) on Chinese Windows, Shift-JIS (932) on Japanese, Big5 (950) on
//! Traditional Chinese, windows-1252 on Western European, and so on. Decoding
//! those bytes as UTF-8 produces replacement characters (the `锟斤拷`/`�`
//! mojibake). Forcing UTF-8 at the source (`chcp 65001`) only fixes one shell
//! and pollutes output, so we instead decode at the one place every byte flows
//! through — the PTY reader — using the actual OS code page.
//!
//! [`PtyDecoder`] wraps an `encoding_rs` streaming decoder. It is:
//! - **Code-page driven, not hard-coded**: the encoding is resolved once from
//!   the OS (`GetConsoleOutputCP`, falling back to `GetACP`) and mapped via the
//!   `codepage` crate, so every locale is handled by the same path with no
//!   per-encoding branches.
//! - **Stateful across reads**: a multi-byte character split across two PTY
//!   reads is buffered and completed on the next chunk (replacing the previous
//!   hand-rolled UTF-8 carry logic).
//! - **An identity transform on UTF-8 systems**, so Unix/modern Windows pay
//!   nothing.

use encoding_rs::{Decoder, Encoding, UTF_8};

/// Streaming byte→UTF-8 decoder for one PTY session.
pub struct PtyDecoder {
    decoder: Decoder,
}

impl PtyDecoder {
    /// Create a decoder for one PTY session. When `encoding` is `Some("utf-8")`
    /// (the agent path, whose shell is forced to UTF-8) the stream is decoded as
    /// UTF-8 regardless of the host console code page; otherwise it falls back to
    /// the OS console code page so interactive shells keep decoding correctly on
    /// localized Windows.
    pub fn new(encoding: Option<&str>) -> Self {
        let encoding = match encoding {
            Some(name) if name.eq_ignore_ascii_case("utf-8") || name.eq_ignore_ascii_case("utf8") => {
                UTF_8
            }
            _ => console_encoding(),
        };
        Self {
            decoder: encoding.new_decoder(),
        }
    }

    /// Decode one chunk of PTY bytes. Any incomplete trailing multi-byte
    /// sequence is retained internally and completed by the next `push`.
    pub fn push(&mut self, bytes: &[u8]) -> String {
        // `decode_to_string` grows the destination as needed and replaces only
        // genuinely malformed sequences, so a single call drains `bytes`.
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

/// Resolve the console output encoding for the current OS, once.
fn console_encoding() -> &'static Encoding {
    #[cfg(windows)]
    {
        // `GetConsoleOutputCP` reflects what console programs actually emit;
        // fall back to the ANSI code page, then UTF-8 if the page is unknown.
        let cp = unsafe { winapi::um::consoleapi::GetConsoleOutputCP() };
        let cp = if cp != 0 {
            cp
        } else {
            unsafe { winapi::um::winnls::GetACP() }
        };
        codepage::to_encoding(cp as u16).unwrap_or(UTF_8)
    }
    #[cfg(not(windows))]
    {
        UTF_8
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8_passthrough() {
        let mut d = PtyDecoder {
            decoder: UTF_8.new_decoder(),
        };
        assert_eq!(d.push("hello 世界".as_bytes()), "hello 世界");
        assert_eq!(d.finish(), "");
    }

    #[test]
    fn rejoins_a_multibyte_char_split_across_reads() {
        // "世" is E4 B8 96 in UTF-8; feed it one byte at a time.
        let bytes = "世".as_bytes().to_vec();
        let mut d = PtyDecoder {
            decoder: UTF_8.new_decoder(),
        };
        let mut out = String::new();
        out.push_str(&d.push(&bytes[0..1]));
        out.push_str(&d.push(&bytes[1..2]));
        out.push_str(&d.push(&bytes[2..3]));
        out.push_str(&d.finish());
        assert_eq!(out, "世");
    }

    #[test]
    fn decodes_legacy_code_page_to_utf8() {
        // 0xC4 0xE3 is "你" in GBK (code page 936); decoding as GBK must yield
        // the correct character, proving the code-page path (not UTF-8) works.
        let gbk = encoding_rs::GBK;
        let mut d = PtyDecoder {
            decoder: gbk.new_decoder(),
        };
        let mut out = d.push(&[0xC4, 0xE3]);
        out.push_str(&d.finish());
        assert_eq!(out, "你");
    }
}
