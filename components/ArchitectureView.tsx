'use client';

import { useMemo, useState } from 'react';
import { Search, ArrowRight, AlertTriangle } from 'lucide-react';
import {
  ARCHITECTURE_SYSTEMS,
  SCENE_TREE_NODES,
} from '@/lib/architecture-data';
import { HEX_ASSETS } from '@/lib/repo-data';
import { filterHexAssets, getCategoryCounts } from '@/lib/godot-docs';

interface ArchitectureViewProps {
  onOpenScript: (scriptPath: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  all: 'Todos',
  building: 'Prédios',
  path: 'Caminhos',
  river: 'Rios',
  unit: 'Unidades',
  stone: 'Pedra',
  grass: 'Grama',
  sand: 'Areia',
  water: 'Água',
  dirt: 'Terra',
  bridge: 'Ponte',
};

export default function ArchitectureView({ onOpenScript }: ArchitectureViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const counts = useMemo(() => getCategoryCounts(HEX_ASSETS), []);
  const filteredAssets = useMemo(
    () => filterHexAssets(HEX_ASSETS, selectedCategory, searchQuery),
    [selectedCategory, searchQuery]
  );

  const categories = ['all', 'building', 'path', 'river', 'unit', 'stone', 'grass', 'sand', 'water', 'dirt', 'bridge'];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          Inspeção Inicial da Estrutura do Projeto
        </h1>
        <p className="mt-1 text-sm text-slate-600 max-w-3xl">
          Mapeamento direto dos arquivos reais de <code className="font-mono text-xs text-slate-800">michiel-van-den-anker/Starter-Kit-Hexagon-World</code> cobrindo cena principal, scripts, grade hexagonal, construção, seleção, câmera, persistência e catálogo de assets.
        </p>
      </div>

      {/* 8 Requested Systems */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5" aria-label="Sistemas identificados">
        {ARCHITECTURE_SYSTEMS.map((sys) => (
          <article
            key={sys.id}
            className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-base font-semibold text-slate-900">
                  {sys.title}
                </h2>
                {sys.jumpToScript && (
                  <button
                    type="button"
                    onClick={() => onOpenScript(sys.jumpToScript!)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 whitespace-nowrap shrink-0"
                  >
                    Inspecionar script
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>

              <p className="font-mono text-xs text-slate-500">
                {sys.files.join(' · ')}
              </p>

              <p className="text-sm text-slate-700 leading-relaxed">
                {sys.summary}
              </p>

              <ul className="space-y-1.5 text-xs sm:text-sm text-slate-600 list-disc pl-4">
                {sys.details.map((line) => (
                  <li key={line} className="leading-relaxed">
                    {line}
                  </li>
                ))}
              </ul>
            </div>

            {sys.technicalNote && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2.5 text-xs text-amber-950 leading-relaxed">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{sys.technicalNote}</span>
              </div>
            )}
          </article>
        ))}
      </section>

      {/* Scene Tree Table */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Árvore de nós da cena principal (res://scenes/main.tscn)
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Hierarquia exata encontrada em <code className="font-mono text-xs">scenes/main.tscn</code>.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-2.5 pr-4">Nó</th>
                <th className="py-2.5 pr-4">Tipo Godot</th>
                <th className="py-2.5">Responsabilidade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {SCENE_TREE_NODES.map((node) => (
                <tr key={`${node.depth}-${node.name}`} className="hover:bg-slate-50">
                  <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                    <span style={{ paddingLeft: `${node.depth * 16}px` }} className="inline-block">
                      {node.depth > 0 ? '└ ' : ''}
                      {node.name}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-emerald-700 whitespace-nowrap">
                    {node.type}
                  </td>
                  <td className="py-2.5 text-xs sm:text-sm text-slate-600">
                    {node.role}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 72 Hexagon Resources Catalog */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Catálogo dos 72 recursos em hexagons/*.tres
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Cada entrada instancia <code className="font-mono text-xs">scripts/hexagon.gd</code> com referência a um modelo <code className="font-mono text-xs">.glb</code> em <code className="font-mono text-xs">models/Hexagons/</code>.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <label htmlFor="hex-search" className="sr-only">
              Filtrar peças hexagonais
            </label>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
            <input
              id="hex-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar peça (ex: house, mine)"
              className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por categoria">
          {categories.map((cat) => {
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {CATEGORY_LABELS[cat] ?? cat} ({counts[cat] ?? 0})
              </button>
            );
          })}
        </div>

        <div className="text-xs text-slate-500 tabular-nums">
          Exibindo <strong className="font-semibold text-slate-900">{filteredAssets.length}</strong> de {HEX_ASSETS.length} recursos
        </div>

        {filteredAssets.length === 0 ? (
          <div className="border border-slate-200 rounded-lg p-8 text-center space-y-3">
            <p className="text-sm font-medium text-slate-900">
              Nenhuma peça encontrada para &ldquo;{searchQuery}&rdquo;
            </p>
            <p className="text-xs text-slate-500">
              Tente limpar o termo de busca ou voltar para a categoria Todos.
            </p>
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('all');
                setSearchQuery('');
              }}
              className="px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors"
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                <tr className="text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Arquivo .tres</th>
                  <th className="py-2.5 px-4">Categoria</th>
                  <th className="py-2.5 px-4">Modelo 3D (.glb)</th>
                  <th className="py-2.5 px-4 text-right">Preço inicial</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs sm:text-sm bg-white">
                {filteredAssets.map((item) => (
                  <tr key={item.file} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono text-xs font-medium text-slate-900 whitespace-nowrap">
                      hexagons/{item.file}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                      {CATEGORY_LABELS[item.category] ?? item.category}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-500 truncate max-w-xs">
                      {item.modelPath}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-slate-900 whitespace-nowrap">
                      ${item.price}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
