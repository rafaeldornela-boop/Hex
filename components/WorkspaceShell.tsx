'use client';
import { withBasePath } from '@/lib/base-path';

import { useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookOpen,
  Compass,
  Download,
  FileCode2,
  FileText,
  Layers,
  Menu,
  Play,
  X,
} from 'lucide-react';
import OverviewSetupView from './OverviewSetupView';
import ArchitectureView from './ArchitectureView';
import ScriptExplorerView from './ScriptExplorerView';
import MarkdownDocView from './MarkdownDocView';
import { README_MD, ROADMAP_MD } from '@/lib/godot-docs';

export type WorkspaceTab =
  | 'overview'
  | 'architecture'
  | 'scripts'
  | 'readme'
  | 'roadmap';

const NAV_ITEMS: {
  id: WorkspaceTab;
  label: string;
  breadcrumb: string;
  icon: typeof Compass;
}[] = [
  {
    id: 'overview',
    label: 'Visão Geral e Setup',
    breadcrumb: 'Visão Geral e Setup',
    icon: Compass,
  },
  {
    id: 'architecture',
    label: 'Inspeção da Arquitetura',
    breadcrumb: 'Inspeção da Arquitetura',
    icon: Layers,
  },
  {
    id: 'scripts',
    label: 'Explorador de Scripts',
    breadcrumb: 'Explorador de Scripts',
    icon: FileCode2,
  },
  {
    id: 'readme',
    label: 'README.md',
    breadcrumb: 'README.md',
    icon: BookOpen,
  },
  {
    id: 'roadmap',
    label: 'ROADMAP.md',
    breadcrumb: 'ROADMAP.md',
    icon: FileText,
  },
];

export default function WorkspaceShell() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [selectedScriptPath, setSelectedScriptPath] = useState<string>(
    'scripts/builder.gd'
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const currentNav =
    NAV_ITEMS.find((item) => item.id === activeTab) ?? NAV_ITEMS[0];

  const handleOpenScript = (path: string) => {
    setSelectedScriptPath(path);
    setActiveTab('scripts');
    setMobileNavOpen(false);
  };

  const handleSelectTab = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    setMobileNavOpen(false);
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-r border-slate-200 sticky top-0 h-screen">
        <div className="h-16 px-6 flex items-center border-b border-slate-200">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            Hexagon World
          </span>
        </div>

        <nav aria-label="Navegação principal" className="p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-emerald-50 text-emerald-900'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    active ? 'text-emerald-700' : 'text-slate-400'
                  }`}
                  aria-hidden="true"
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="mx-3 mt-4 pt-4 border-t border-slate-200 px-1 space-y-3">
          <Link
            href="/"
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 transition-colors whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
            Jogar Hexagon World 3D
          </Link>
          <div className="px-2 text-xs text-slate-500 space-y-1">
            <p className="font-medium text-slate-700">Godot 4.2 · Forward Plus</p>
            <p className="font-mono text-[11px] truncate">res://scenes/main.tscn</p>
          </div>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      <AnimatePresence>
        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 lg:hidden flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setMobileNavOpen(false)}
              className="fixed inset-0 bg-slate-900/40"
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-50 w-64 max-w-[80vw] bg-white h-full flex flex-col border-r border-slate-200"
            >
              <div className="h-16 px-4 flex items-center justify-between border-b border-slate-200">
                <span className="font-display text-base font-bold text-slate-900">
                  Hexagon World
                </span>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Fechar menu"
                  className="p-2 rounded-lg text-slate-600 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
              <nav aria-label="Navegação móvel" className="flex-1 p-3 space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectTab(item.id)}
                      aria-current={active ? 'page' : undefined}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        active
                          ? 'bg-emerald-50 text-emerald-900'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          active ? 'text-emerald-700' : 'text-slate-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb on left, 1 primary action on right */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Abrir menu de navegação"
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 hidden sm:inline whitespace-nowrap">
                Starter-Kit-Hexagon-World
              </span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <span className="font-medium text-slate-900 truncate">
                {currentNav.breadcrumb}
              </span>
            </nav>
          </div>

          <a
            href={withBasePath('/downloads/hexagon-world-starter.zip')}
            download="hexagon-world-starter.zip"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-700 text-white text-xs font-medium hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Baixar Projeto (.zip)
          </a>
        </header>

        <main className="flex-1 px-4 sm:px-8 py-6 sm:py-8 max-w-6xl w-full mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {activeTab === 'overview' && (
                <OverviewSetupView
                  onOpenScript={handleOpenScript}
                  onNavigateTab={(tab) => setActiveTab(tab)}
                />
              )}
              {activeTab === 'architecture' && (
                <ArchitectureView onOpenScript={handleOpenScript} />
              )}
              {activeTab === 'scripts' && (
                <ScriptExplorerView
                  selectedScriptPath={selectedScriptPath}
                  onSelectScript={setSelectedScriptPath}
                />
              )}
              {activeTab === 'readme' && (
                <MarkdownDocView
                  filename="README.md"
                  title="README.md preparado"
                  subtitle="Documentação inicial pronta para a raiz do seu novo repositório de aprendizado."
                  content={README_MD}
                />
              )}
              {activeTab === 'roadmap' && (
                <MarkdownDocView
                  filename="ROADMAP.md"
                  title="ROADMAP.md preparado"
                  subtitle="Lista estruturada de evoluções futuras planejadas — nenhuma mecânica foi implementada ainda."
                  content={ROADMAP_MD}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
