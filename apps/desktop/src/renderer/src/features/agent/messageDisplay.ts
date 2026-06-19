/**
 * Display-only `/skill` prefixes are stored as quoted text for the runtime.
 * The bubble renders them back as inline atoms so the sent message reads like
 * the composer line, not as implementation syntax.
 */
export function splitSkillPrefix(content: string): { skills: string[]; text: string } {
  const skills: string[] = [];
  let text = content;
  for (;;) {
    const match = /^"([^"\r\n]+)"(?:[ \t]+|$)/.exec(text);
    if (!match) {
      break;
    }
    skills.push(match[1] ?? "");
    text = text.slice(match[0].length);
  }
  return { skills, text };
}
