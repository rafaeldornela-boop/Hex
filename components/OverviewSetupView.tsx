'use client';

import { useState } from 'react';
import Image from 'next/image';
import { withBasePath } from '@/lib/base-path';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FolderGit2,
  ArrowRight,
  Info,
} from 'lucide-react';
import {
  ORIGINAL_REPO_URL,
  buildRepoUrl,
  generateGitSetupSteps,
} from '@/lib/godot-docs';
import { CONTROLS_LIST, READING_ORDER } from '@/lib/architecture-data';

interface OverviewSetupViewProps {
  onOpenScript: (scriptPath: string) => void;
  onNavigateTab: (tab: 'architecture' | 'scripts' | 'readme' | 'roadmap') => void;
}

export default function OverviewSetupView({
  onOpenScript,
  onNavigateTab,
}: OverviewSetupViewProps) {
  const [githubUser, setGithubUser] = useState('seu-usuario');
  const [repoName, setRepoName] = useState('godot-hexagon-world-estudo');
  const [protocol, setProtocol] = useState<'https' | 'ssh'>('https');
  const [mode, setMode] = useState<'zip' | 'clone'>('zip');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const steps = generateGitSetupSteps({
    githubUser,
    repoName,
    protocol,
    mode,
  });

  const targetUrl = buildRepoUrl(githubUser, repoName, protocol);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 2000);
    } catch {
      setCopiedId(null);
    }
  };

  const allCommands = steps.map((s) => `# ${s.title}\n${s.command}`).join('\n\n');

  return (
    <div className="space-y-8">
      {/* Honest Environment Notice & Primary Summary */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-stretch gap-8">
          <div className="flex-1 flex flex-col justify-between space-y-5">
            <div className="space-y-3">
              <p className="text-xs font-medium text-emerald-700">
                Base inspecionada · Starter-Kit-Hexagon-World · Sem alterações de gameplay
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
                Cópia limpa pronta para o Godot e para o seu novo repositório GitHub
              </h1>
              <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl">
                O repositório original foi clonado e inspecionado integralmente. O pacote
                disponível para download preserva todos os arquivos originais do projeto
                Godot (sem a pasta <code className="font-mono text-xs text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">.git</code>),
                já incluindo o novo <strong className="font-semibold text-slate-900">README.md</strong> e
                o <strong className="font-semibold text-slate-900">ROADMAP.md</strong> solicitados.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-start gap-3">
              <Info className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                <strong className="font-semibold text-slate-900">Sobre o envio ao GitHub:</strong>{' '}
                este ambiente não possui credenciais autenticadas na sua conta do GitHub para criar o
                repositório remoto ou executar <code className="font-mono text-xs">git push</code> automaticamente.
                Baixe o ZIP preparado abaixo e execute os 3 comandos gerados para publicar no seu perfil.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <a
                href={withBasePath('/downloads/hexagon-world-starter.zip')}
                download="hexagon-world-starter.zip"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                Baixar Projeto Godot (.zip · 748 KB)
              </a>
              <button
                type="button"
                onClick={() => onNavigateTab('architecture')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-800 text-sm font-medium hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                Ver Inspeção Completa
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
              <a
                href={ORIGINAL_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
              >
                Repositório original
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="lg:w-[390px] shrink-0 flex flex-col justify-center">
            <div className="relative w-full aspect-[4/3] rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
              <Image
                src={withBasePath('/images/hexagon-world-preview.png')}
                alt="Captura original incluída no repositório Starter-Kit-Hexagon-World"
                fill
                sizes="(max-width: 1024px) 100vw, 390px"
                className="object-contain bg-slate-200/60"
                referrerPolicy="no-referrer"
                priority
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Captura original incluída em <span className="font-mono">screenshots/screenshot.png</span>
            </p>
          </div>
        </div>
      </section>

      {/* Key Facts Strip (Full-Width 4-Column Row Below Hero Split) */}
      <section aria-label="Resumo técnico identificado" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Versão do Godot</p>
          <p className="mt-1 font-display text-lg font-bold text-slate-900 tabular-nums">
            Godot 4.2
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Forward Plus · <span className="font-mono">config_version=5</span>
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Cena Principal</p>
          <p className="mt-1 font-mono text-sm font-semibold text-slate-900 truncate" title="res://scenes/main.tscn">
            res://scenes/main.tscn
          </p>
          <p className="mt-1 text-xs text-slate-500">
            12 nós · Builder, View, Hexagons
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Scripts GDScript</p>
          <p className="mt-1 font-display text-lg font-bold text-slate-900 tabular-nums">
            7 arquivos
          </p>
          <p className="mt-1 text-xs text-slate-500">
            5 do projeto · 2 de gdhexgrid
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Peças Hexagonais</p>
          <p className="mt-1 font-display text-lg font-bold text-slate-900 tabular-nums">
            72 recursos .tres
          </p>
          <p className="mt-1 text-xs text-slate-500">
            18 prédios · 16 caminhos · 14 rios
          </p>
        </div>
      </section>

      {/* Interactive GitHub Setup Command Builder */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 flex items-center gap-2">
              <FolderGit2 className="w-5 h-5 text-emerald-700" aria-hidden="true" />
              Publicar no seu novo repositório GitHub
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Informe seu usuário do GitHub e o nome desejado para gerar os comandos exatos de commit e push.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleCopy('all-steps', allCommands)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            {copiedId === 'all-steps' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                Todos copiados
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                Copiar todos os comandos
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label htmlFor="github-user" className="block text-xs font-medium text-slate-700 mb-1.5">
              Seu usuário no GitHub
            </label>
            <input
              id="github-user"
              type="text"
              value={githubUser}
              onChange={(e) => setGithubUser(e.target.value)}
              placeholder="ex: rafaeldornela"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
            />
          </div>

          <div>
            <label htmlFor="repo-name" className="block text-xs font-medium text-slate-700 mb-1.5">
              Nome do novo repositório
            </label>
            <input
              id="repo-name"
              type="text"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="godot-hexagon-world-estudo"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-700 mb-1.5">
              Método de partida
            </span>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg" role="group" aria-label="Método de partida">
              <button
                type="button"
                onClick={() => setMode('zip')}
                className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === 'zip'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Usar ZIP pronto
              </button>
              <button
                type="button"
                onClick={() => setMode('clone')}
                className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === 'clone'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Clonar original
              </button>
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-700 mb-1.5">
              Protocolo Git
            </span>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg" role="group" aria-label="Protocolo Git">
              <button
                type="button"
                onClick={() => setProtocol('https')}
                className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  protocol === 'https'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                HTTPS
              </button>
              <button
                type="button"
                onClick={() => setProtocol('ssh')}
                className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  protocol === 'ssh'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                SSH
              </button>
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
          <span>URL destino configurada:</span>
          <code className="font-mono text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
            {targetUrl}
          </code>
        </div>

        <div className="space-y-4">
          {steps.map((step, idx) => {
            const stepKey = `step-${idx}`;
            return (
              <div key={step.title} className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between gap-4 border-b border-slate-200">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{step.title}</h3>
                    <p className="text-xs text-slate-600 mt-0.5">{step.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(stepKey, step.command)}
                    aria-label={`Copiar comandos do passo ${idx + 1}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    {copiedId === stepKey ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                        Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        Copiar
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-4 bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed">
                  <code>{step.command}</code>
                </pre>
              </div>
            );
          })}
        </div>
      </section>

      {/* Bottom 2-Column Split: Reading Order + Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Por quais arquivos começar a estudar
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Ordem recomendada para entender o fluxo completo sem se perder na matemática hexagonal logo no primeiro dia.
          </p>

          <ol className="mt-5 divide-y divide-slate-200">
            {READING_ORDER.map((item) => (
              <li key={item.step} className="py-3.5 first:pt-0 last:pb-0 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="font-mono text-xs font-semibold text-emerald-700 tabular-nums mt-0.5">
                    {item.step}.
                  </span>
                  <div>
                    <p className="font-mono text-sm font-semibold text-slate-900">{item.file}</p>
                    <p className="mt-1 text-xs sm:text-sm text-slate-600 leading-relaxed">
                      {item.reason}
                    </p>
                  </div>
                </div>
                {item.scriptPath && (
                  <button
                    type="button"
                    onClick={() => onOpenScript(item.scriptPath!)}
                    className="text-xs font-medium text-emerald-700 hover:text-emerald-800 whitespace-nowrap shrink-0 mt-0.5"
                  >
                    Abrir código
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Controles preservados no Godot
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Definidos na seção <code className="font-mono text-xs">[input]</code> de <code className="font-mono text-xs">project.godot</code>.
          </p>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2 pr-3">Entrada</th>
                  <th className="py-2">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                {CONTROLS_LIST.map((ctrl) => (
                  <tr key={ctrl.keys}>
                    <td className="py-2.5 pr-3 font-mono text-xs font-medium text-slate-900 whitespace-nowrap">
                      {ctrl.keys}
                    </td>
                    <td className="py-2.5 text-slate-600">{ctrl.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
