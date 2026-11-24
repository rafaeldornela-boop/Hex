'use client';

import { useState } from 'react';
import { Check, Copy, FileCode2 } from 'lucide-react';
import { SCRIPT_FILES } from '@/lib/repo-data';

interface ScriptExplorerViewProps {
  selectedScriptPath: string;
  onSelectScript: (path: string) => void;
}

export default function ScriptExplorerView({
  selectedScriptPath,
  onSelectScript,
}: ScriptExplorerViewProps) {
  const [copied, setCopied] = useState(false);

  const activeScript =
    SCRIPT_FILES.find((s) => s.path === selectedScriptPath) ?? SCRIPT_FILES[0];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeScript.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          Explorador dos Scripts GDScript Originais
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Código-fonte exato dos 7 scripts encontrados no repositório, preservados sem modificações de gameplay.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <p className="text-xs font-semibold text-slate-700">
              Arquivos em scripts/ ({SCRIPT_FILES.length})
            </p>
          </div>
          <nav aria-label="Lista de scripts GDScript" className="divide-y divide-slate-100">
            {SCRIPT_FILES.map((script) => {
              const isSelected = script.path === activeScript.path;
              return (
                <button
                  key={script.path}
                  type="button"
                  onClick={() => onSelectScript(script.path)}
                  className={`w-full text-left px-4 py-3 transition-colors flex items-start justify-between gap-3 ${
                    isSelected
                      ? 'bg-emerald-50 text-emerald-950'
                      : 'bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold truncate">
                      {script.filename}
                    </p>
                    <p className="font-mono text-[11px] text-slate-500 truncate mt-0.5">
                      {script.path}
                    </p>
                  </div>
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap shrink-0 mt-0.5">
                    {script.lines} linhas
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                <h2 className="font-mono text-sm font-semibold text-slate-900 truncate">
                  {activeScript.path}
                </h2>
              </div>
              <p className="mt-1 text-xs sm:text-sm text-slate-600 leading-relaxed">
                {activeScript.summary}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                  Código copiado
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  Copiar GDScript
                </>
              )}
            </button>
          </div>

          <div className="bg-slate-900 text-slate-100 overflow-x-auto max-h-[600px] overflow-y-auto">
            <pre className="p-5 text-xs font-mono leading-relaxed">
              <code>{activeScript.code}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
