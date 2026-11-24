'use client';

import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';

interface MarkdownDocViewProps {
  filename: string;
  title: string;
  subtitle: string;
  content: string;
}

export default function MarkdownDocView({
  filename,
  title,
  subtitle,
  content,
}: MarkdownDocViewProps) {
  const [viewMode, setViewMode] = useState<'formatted' | 'raw'>('formatted');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            {title}
          </h1>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg" role="group" aria-label="Modo de visualização">
            <button
              type="button"
              onClick={() => setViewMode('formatted')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewMode === 'formatted'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Formatado
            </button>
            <button
              type="button"
              onClick={() => setViewMode('raw')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewMode === 'raw'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Markdown bruto
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                Copiar {filename}
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 text-white text-xs font-medium hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Baixar {filename}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
          <span className="font-mono font-medium text-slate-900">{filename}</span>
          <span>Já incluído na raiz do arquivo hexagon-world-starter.zip</span>
        </div>

        {viewMode === 'raw' ? (
          <pre className="p-6 bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap">
            <code>{content}</code>
          </pre>
        ) : (
          <div className="p-6 sm:p-8 max-w-4xl">
            <SimpleMarkdownRenderer markdown={content} />
          </div>
        )}
      </div>
    </div>
  );
}

function SimpleMarkdownRenderer({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre
          key={`code-${i}`}
          className="my-4 p-4 rounded-lg bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      i++;
      continue;
    }

    if (line.startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const rows = tableLines
        .filter((l) => !/^\|[\s-|]+\|$/.test(l))
        .map((l) =>
          l
            .slice(1, -1)
            .split('|')
            .map((cell) => cell.trim())
        );

      if (rows.length > 0) {
        const [header, ...body] = rows;
        elements.push(
          <div key={`table-${i}`} className="my-4 overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {header.map((cell, idx) => (
                    <th key={idx} className="py-2.5 px-4 font-semibold text-slate-700">
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {body.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="py-2.5 px-4 text-slate-700">
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    if (line.startsWith('# ')) {
      elements.push(
        <h2 key={`h1-${i}`} className="font-display text-2xl font-bold text-slate-900 mb-4">
          {renderInline(line.slice(2))}
        </h2>
      );
      i++;
      continue;
    }

    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={`h2-${i}`} className="font-display text-lg font-semibold text-slate-900 mt-7 mb-2.5">
          {renderInline(line.slice(3))}
        </h3>
      );
      i++;
      continue;
    }

    if (line.startsWith('### ')) {
      elements.push(
        <h4 key={`h3-${i}`} className="font-display text-base font-semibold text-slate-900 mt-5 mb-2">
          {renderInline(line.slice(4))}
        </h4>
      );
      i++;
      continue;
    }

    if (line.trim() === '---') {
      elements.push(<hr key={`hr-${i}`} className="my-6 border-slate-200" />);
      i++;
      continue;
    }

    if (line.startsWith('- [ ] ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- [ ] ')) {
        items.push(lines[i].slice(6));
        i++;
      }
      elements.push(
        <ul key={`checks-${i}`} className="my-3 space-y-2.5">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2.5 text-sm text-slate-700 leading-relaxed">
              <span
                className="w-4 h-4 mt-0.5 rounded border border-slate-300 bg-slate-50 shrink-0 inline-block"
                aria-hidden="true"
              />
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('  - ')) {
      const items: string[] = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('  - '))) {
        items.push(lines[i].replace(/^\s*-\s+/, ''));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-3 space-y-1.5 list-disc pl-5 text-sm text-slate-700 leading-relaxed">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ''));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="my-3 space-y-1.5 list-decimal pl-5 text-sm text-slate-700 leading-relaxed">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    if (line.trim().length > 0) {
      elements.push(
        <p key={`p-${i}`} className="my-2.5 text-sm text-slate-700 leading-relaxed">
          {renderInline(line)}
        </p>
      );
    }
    i++;
  }

  return <div>{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={idx}
          className="font-mono text-xs bg-slate-100 text-slate-900 px-1.5 py-0.5 rounded"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={idx}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return part;
  });
}
