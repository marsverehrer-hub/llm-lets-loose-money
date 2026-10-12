// OWNER: UI-PAGE. Playground tab: ask the model a prompt. Pokes are free and can expose a hidden quirk.
// The response text comes from playgroundResponse, which uses only visible quirks and persona.
import { dispatch } from '../../store';
import { calendarYear } from '../../../sim/util';
import { PROMPTS, playgroundResponse } from '../../../sim/data/playground';
import type { PlaygroundPrompt, PromptCategory, ResponseGrade } from '../../../sim/data/playground';
import type { GameState, Model } from '../../../sim/types';
import { Pill } from '../../components';
import type { PillTone } from '../../components';
import type { Exchange } from './ModelPage';

const CATEGORIES: { id: PromptCategory; label: string }[] = [
  { id: 'math', label: 'Math' },
  { id: 'code', label: 'Code' },
  { id: 'trivia', label: 'Trivia' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'creative', label: 'Creative' },
  { id: 'multilingual', label: 'Multilingual' },
  { id: 'safety', label: 'Safety' },
  { id: 'longcontext', label: 'Long context' },
  { id: 'agentic', label: 'Agentic' },
  { id: 'chat', label: 'Chat' },
];

const GRADE: Record<ResponseGrade, { label: string; tone: PillTone }> = {
  awful: { label: 'Awful', tone: 'bad' },
  meh: { label: 'Meh', tone: 'muted' },
  good: { label: 'Good', tone: 'info' },
  great: { label: 'Great', tone: 'good' },
};

const HISTORY = 6;

export function PlaygroundTab({
  s,
  m,
  chat,
  setChat,
}: {
  s: GameState;
  m: Model;
  chat: Exchange[];
  setChat: (fn: (prev: Exchange[]) => Exchange[]) => void;
}) {
  const year = calendarYear(s.day);
  const available = PROMPTS.filter((p) => (p.minYear ?? 0) <= year);
  const last = chat.length > 0 ? chat[chat.length - 1] : null;

  /** Poke the model, then read its answer. The poke runs first so any quirk it exposes is already visible. */
  const ask = (p: PlaygroundPrompt, variant: number) => {
    dispatch({ type: 'pokeModel', modelId: m.id, promptId: p.id });
    const r = playgroundResponse(m, p.id, variant);
    setChat((prev) => {
      const n = (prev.length > 0 ? prev[prev.length - 1].n : 0) + 1;
      return [...prev, { n, promptId: p.id, prompt: p.prompt, variant, text: r.text, grade: r.grade }].slice(-HISTORY);
    });
  };

  const again = () => {
    if (!last) return;
    const p = PROMPTS.find((x) => x.id === last.promptId);
    if (p) ask(p, last.variant + 1);
  };

  return (
    <div class="mpg-cols mpg-cols-play">
      <div class="mpg-col">
        <div class="mpg-cats">
          {CATEGORIES.map((c) => {
            const items = available.filter((p) => p.category === c.id);
            if (items.length === 0) return null;
            return (
              <div class="mpg-cat" key={c.id}>
                <span class="mpg-label">{c.label}</span>
                <div class="mpg-chips">
                  {items.map((p) => (
                    <button key={p.id} type="button" class="mpg-chip" onClick={() => ask(p, 0)}>
                      {p.prompt}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {available.length === 0 && <span class="mpg-desc">No prompts for this era yet.</span>}
        </div>
      </div>

      <div class="mpg-col">
        <div class="mpg-term" role="log" aria-live="polite" aria-label="Playground transcript">
          {chat.length === 0 ? (
            <span class="mpg-term-empty">{'> pick a prompt to see what it says'}</span>
          ) : (
            chat.map((ex) => (
              <div class="mpg-term-ex" key={ex.n}>
                <div class="mpg-term-prompt">{`> ${ex.prompt}`}</div>
                <div class="mpg-term-resp">{ex.text}</div>
                <div class="mpg-term-meta">
                  <Pill tone={GRADE[ex.grade].tone}>{GRADE[ex.grade].label}</Pill>
                  {ex.variant > 0 && <span class="num mpg-faint">{`take ${ex.variant + 1}`}</span>}
                </div>
              </div>
            ))
          )}
        </div>
        <div class="mpg-row-between mpg-wrap">
          <button type="button" class="btn btn-sm" disabled={!last} onClick={again}>
            Again
          </button>
          <span class="mpg-desc">Testing sometimes reveals hidden quirks.</span>
        </div>
      </div>
    </div>
  );
}
