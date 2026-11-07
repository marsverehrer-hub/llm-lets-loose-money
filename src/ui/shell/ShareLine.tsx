// The one-line result of a daily challenge, with Copy. Where the clipboard is refused, the text is selected instead.
import { useRef, useState } from 'preact/hooks';
import { Button } from '../components';
import './share.css';

export function ShareLine({ text }: { text: string }) {
  const field = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setNote('Copied.');
    } catch {
      field.current?.focus();
      field.current?.select();
      setNote('Press Ctrl+C or Cmd+C to copy.');
    }
  };

  return (
    <div class="share-line">
      <input
        ref={field}
        class="input share-text"
        readOnly
        value={text}
        aria-label="Share text"
        onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
      />
      <Button onClick={copy}>Copy</Button>
      <span class="small muted" role="status">
        {note}
      </span>
    </div>
  );
}
