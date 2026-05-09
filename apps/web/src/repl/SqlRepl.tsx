import { useEffect, useRef } from 'react';
import { workerApi } from '../db/prisma-sqlite-client';
import './repl.css';
import SplitPane from './SplitPane';
import './SqlRepl.css';
import { useReplHistory } from './useReplHistory';

function formatTable(columnNames: string[], rows: unknown[][]): string {
  if (rows.length === 0) return `(0 rows)\nColumns: ${columnNames.join(', ')}`;
  const cols = columnNames.map((name, i) => {
    const values = rows.map((r) => String(r[i] ?? 'NULL'));
    const width = Math.max(name.length, ...values.map((v) => v.length));
    return { name, width, values };
  });
  const header = cols.map((c) => c.name.padEnd(c.width)).join(' | ');
  const sep = cols.map((c) => '-'.repeat(c.width)).join('-+-');
  const body = rows.map((_, ri) =>
    cols.map((c) => c.values[ri].padEnd(c.width)).join(' | '),
  );
  return [
    header,
    sep,
    ...body,
    `(${rows.length} row${rows.length === 1 ? '' : 's'})`,
  ].join('\n');
}

export default function SqlRepl() {
  const { history, append, clear, recallPrev, recallNext } =
    useReplHistory('sql-repl');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const historyPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = historyPanelRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  async function run() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const input = textarea.value.trim();
    if (!input) return;

    if (input === 'clear' || input === '/c') {
      clear();
      textarea.value = '';
      return;
    }

    let output: string;
    let isError = false;
    try {
      const isWrite =
        /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA)/i.test(input);
      if (isWrite) {
        const count = await workerApi.executeRaw(input, []);
        output = `${count} row${count === 1 ? '' : 's'} affected`;
      } else {
        const result = await workerApi.queryRaw({ sql: input, args: [] });
        output = formatTable(result.columnNames, result.rows);
      }
    } catch (err) {
      isError = true;
      output = err instanceof Error ? err.message : String(err);
    }

    append({ input, output, isError });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      run();
      return;
    }
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (textareaRef.current) textareaRef.current.value = '';
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (e.key === 'ArrowUp' && textarea.selectionStart === 0) {
      const recalled = recallPrev(textarea.value);
      if (recalled === null) return;
      e.preventDefault();
      textarea.value = recalled;
    }
    if (
      e.key === 'ArrowDown' &&
      textarea.selectionStart === textarea.value.length
    ) {
      const recalled = recallNext();
      if (recalled === null) return;
      e.preventDefault();
      textarea.value = recalled;
    }
  }

  const editorPanel = (
    <div className="sql-editor">
      <textarea
        ref={textareaRef}
        className="sql-textarea"
        onKeyDown={handleKeyDown}
        placeholder="SQL — Cmd+Enter to run"
        spellCheck={false}
      />
    </div>
  );

  const historyPanel = (
    <div
      className="repl-history"
      ref={historyPanelRef}
      onKeyDown={(e) => {
        if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(historyPanelRef.current!);
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }}
      tabIndex={0}
    >
      {history.map((entry, i) => (
        <div key={i} className="repl-entry">
          <div className="repl-input">&gt; {entry.input}</div>
          <pre
            className={`repl-output ${entry.isError ? 'repl-output-err' : 'repl-output-ok'}`}
          >
            {entry.output}
          </pre>
        </div>
      ))}
    </div>
  );

  return (
    <SplitPane
      left={editorPanel}
      right={historyPanel}
      storageKey="sql-repl-split"
    />
  );
}
