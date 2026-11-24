export interface HexAssetEntry {
  file: string;
  name: string;
  category: string;
  modelPath: string;
  price: number;
}

export interface GitSetupOptions {
  githubUser: string;
  repoName: string;
  protocol: 'https' | 'ssh';
  mode: 'zip' | 'clone';
}

export interface GitCommandStep {
  title: string;
  description: string;
  command: string;
}

export const ORIGINAL_REPO_URL =
  'https://github.com/michiel-van-den-anker/Starter-Kit-Hexagon-World';

export const README_MD = `# Hexagon World — Projeto de Aprendizado em Godot

Este repositório é uma **cópia independente de aprendizado** baseada no projeto open source [Starter-Kit-Hexagon-World](https://github.com/michiel-van-den-anker/Starter-Kit-Hexagon-World) (de Michiel van den Anker), que por sua vez adapta o *Starter Kit City Builder* de KenneyNL para uma grade hexagonal 3D.

O objetivo inicial deste repositório é manter a base original limpa, funcional e documentada para estudar a arquitetura de jogos no Godot Engine e evoluir novas mecânicas de forma gradual, uma por vez.

---

## Versão do Godot necessária

- **Recomendada:** **Godot 4.2** (ou 4.2.x estável) com renderizador **Forward Plus**.
  - O arquivo \`project.godot\` define \`config_version=5\` e \`config/features=PackedStringArray("4.2", "Forward Plus")\`.
  - Observação: o \`README.md\` herdado do template original do Kenney mencionava \`Godot 4.1.1.stable\`, mas o projeto foi salvo com recursos do Godot 4.2.

---

## Como executar o projeto

1. Instale o **Godot Engine 4.2+** (versão Standard, GDScript).
2. Clone este repositório (ou extraia os arquivos do projeto) em uma pasta local.
3. Abra o **Godot Project Manager**, clique em **Import** e selecione o arquivo \`project.godot\` na raiz do projeto.
4. Aguarde a importação automática dos modelos \`.glb\`, texturas e fontes.
5. Pressione **F5** (ou clique no botão **Play**) para executar a cena principal (\`res://scenes/main.tscn\`).

### Controles padrão (preservados do projeto original)

| Tecla / Mouse | Ação |
| --- | --- |
| \`W\` \`A\` \`S\` \`D\` | Mover a câmera |
| \`F\` | Centralizar a câmera na origem |
| Botão do meio do mouse (segurar + mover) | Rotacionar a câmera |
| Botão esquerdo do mouse | Posicionar hexágono / construção |
| Botão direito do mouse | Rotacionar a peça selecionada em 60° |
| \`Q\` / \`E\` (ou roda do mouse) | Alternar entre os 72 hexágonos disponíveis |
| \`DEL\` | Ação \`demolish\` mapeada no projeto original |
| \`F1\` | Salvar mapa em \`user://map.res\` |
| \`F2\` | Carregar mapa de \`user://map.res\` |

---

## Estrutura básica dos principais arquivos

\`\`\`text
.
├── project.godot                   # Configuração principal (Godot 4.2, Input Map, main_scene)
├── scenes/
│   ├── main.tscn                   # Cena principal (Builder, Selector, View/Camera, UI, Hexagons)
│   └── main-environment.tres       # Ambiente 3D, iluminação e céu
├── scripts/
│   ├── builder.gd                  # Controle central: seleção, construção, rotação, dinheiro e save/load
│   ├── view.gd                     # Controle suave da câmera (movimento WASD, rotação e centralização)
│   ├── hexagon.gd                  # Resource customizado (class_name Hexagon: model e price)
│   ├── data_map.gd                 # Resource de dados do mapa salvo (cash e array de structures)
│   ├── data_structure.gd           # Resource de cada peça salva (position, orientation, structure)
│   └── godot-gdhexgrid/
│       ├── HexGrid.gd              # Conversão entre coordenadas do mundo 3D e grade hexagonal
│       └── HexCell.gd              # Representação de célula hexagonal (cube, axial e offset coords)
├── hexagons/                       # 72 arquivos .tres definindo prédios, terrenos, rios, caminhos e unidades
├── models/Hexagons/                # Modelos 3D (.glb) e textura compartilhada (Textures/colormap.png)
├── sprites/                        # Ícones 2D da interface (coin.png e selector.png)
├── fonts/                          # Fonte da interface (lilita_one_regular.ttf)
├── sample map/map.res              # Exemplo de mapa salvo
├── README.md                       # Este guia inicial
└── ROADMAP.md                      # Planejamento de futuras evoluções (ainda não implementadas)
\`\`\`

---

## Licenças e Créditos

- Base hexagonal: [michiel-van-den-anker/Starter-Kit-Hexagon-World](https://github.com/michiel-van-den-anker/Starter-Kit-Hexagon-World)
- Template original e assets 3D/2D (CC0): [KenneyNL](https://kenney.nl/) (código sob licença MIT, veja \`LICENSE.md\`).
- Biblioteca de grade hexagonal: \`godot-gdhexgrid\` (veja \`scripts/godot-gdhexgrid/LICENSE.txt\`).
`;

export const ROADMAP_MD = `# ROADMAP — Evoluções Futuras (Planejamento)

Este documento lista ideias de mecânicas para estudar e implementar **gradualmente** em etapas futuras.
**Status atual:** nenhuma dessas mecânicas foi implementada ainda — o projeto permanece fiel ao funcionamento original para servir como linha de base limpa.

---

## Fase 1 — Base de Território e Recursos

- [ ] **Recursos por território:** associar tipos de terreno (floresta, montanha, colina, planície, água) a recursos naturais disponíveis em cada hexágono.
- [ ] **Madeira:** recurso coletável em hexágonos de floresta/madeireira (\`grass-forest\`, \`dirt-lumber\`).
- [ ] **Pedra:** recurso extraído em hexágonos rochosos ou colinas (\`stone\`, \`stone-hill\`, \`stone-rocks\`).
- [ ] **Minério:** recurso de áreas montanhosas e minas (\`stone-mountain\`, \`building-mine\`, \`building-smelter\`).

## Fase 2 — População e Habitação

- [ ] **População:** contador global de habitantes com capacidade máxima e crescimento gradual.
- [ ] **Casas:** estruturas residenciais (\`building-house\`, \`building-cabin\`, \`building-village\`) que aumentam o limite de população.
- [ ] **Trabalhadores:** alocação de parte da população para operar construções produtivas e extrair recursos.

## Fase 3 — Economia e Automação

- [ ] **Produção automática:** ciclo periódico (timer/tick) que gera madeira, pedra, minério ou alimentos conforme construções ativas e trabalhadores alocados.
- [ ] **Dinheiro:** evolução do saldo atual (\`DataMap.cash\`) integrando custos reais por construção, manutenção e geração de receita (ex.: \`building-market\`, \`building-port\`).

## Fase 4 — Expansão e Progressão da Cidade

- [ ] **Expansão territorial:** sistema de fronteiras desbloqueáveis, permitindo conquistar ou comprar novos anéis/hexágonos adjacentes usando \`HexCell.get_adjacent\`.
- [ ] **Melhorias de construções:** sistema de níveis/upgrades para estruturas já posicionadas no mapa, aumentando eficiência ou capacidade.
- [ ] **Evolução da cidade:** marcos de progressão (acampamento → vila → cidade → cidadela/castelo) que desbloqueiam novas construções e objetivos.

---

## Diretriz de Estudo

Cada item acima deve ser desenvolvido em **uma branch ou commit dedicado**, testando no Godot a cada passo para compreender:
1. Estrutura de dados (\`Resource\`, \`Dictionary\`, \`HexCell\`);
2. Separação entre lógica de simulação e visualização 3D;
3. Atualização de interface (UI) via sinais (\`signal\`);
4. Persistência compatível com \`DataMap\` / \`ResourceSaver\`.
`;

export function sanitizeSlug(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
  return cleaned.length > 0 ? cleaned : fallback;
}

export function buildRepoUrl(
  githubUser: string,
  repoName: string,
  protocol: 'https' | 'ssh' = 'https'
): string {
  const user = sanitizeSlug(githubUser, 'SEU-USUARIO');
  const repo = sanitizeSlug(repoName, 'godot-hexagon-world-estudo');
  if (protocol === 'ssh') {
    return `git@github.com:${user}/${repo}.git`;
  }
  return `https://github.com/${user}/${repo}.git`;
}

export function generateGitSetupSteps(options: GitSetupOptions): GitCommandStep[] {
  const user = sanitizeSlug(options.githubUser, 'SEU-USUARIO');
  const repo = sanitizeSlug(options.repoName, 'godot-hexagon-world-estudo');
  const remoteUrl = buildRepoUrl(user, repo, options.protocol);

  if (options.mode === 'zip') {
    return [
      {
        title: '1. Criar o novo repositório vazio no GitHub',
        description: `Acesse github.com/new e crie um repositório vazio chamado "${repo}" (sem README, .gitignore ou licença inicial).`,
        command: `# Se usar GitHub CLI (opcional):\ngh repo create ${user}/${repo} --public`,
      },
      {
        title: '2. Extrair o pacote preparado e iniciar um Git independente',
        description:
          'O ZIP já contém o projeto original intacto + README.md e ROADMAP.md, sem histórico vinculado ao repositório original.',
        command: `unzip hexagon-world-starter.zip -d ${repo}\ncd ${repo}\ngit init -b main\ngit add .\ngit commit -m "Preparacao inicial: copia limpa do Starter-Kit-Hexagon-World com README e ROADMAP"`,
      },
      {
        title: '3. Conectar ao seu repositório e enviar o commit inicial',
        description:
          'Define seu novo repositório como origin e faz push da branch main.',
        command: `git remote add origin ${remoteUrl}\ngit push -u origin main`,
      },
    ];
  }

  return [
    {
      title: '1. Clonar o original e desvincular o histórico Git',
      description:
        'Cria uma cópia completamente independente do repositório original na sua máquina.',
      command: `git clone ${ORIGINAL_REPO_URL}.git ${repo}\ncd ${repo}\nrm -rf .git\ngit init -b main`,
    },
    {
      title: '2. Adicionar os arquivos README.md e ROADMAP.md',
      description:
        'Substitua o README.md e adicione o ROADMAP.md baixados nas abas deste guia na raiz da pasta do projeto.',
      command: `# Após salvar README.md e ROADMAP.md na pasta ${repo}:\ngit add .\ngit commit -m "Preparacao inicial: copia limpa do Starter-Kit-Hexagon-World com README e ROADMAP"`,
    },
    {
      title: '3. Enviar para o seu novo repositório no GitHub',
      description: `Crie antes o repositório vazio "${repo}" em github.com/new e execute o push.`,
      command: `git remote add origin ${remoteUrl}\ngit push -u origin main`,
    },
  ];
}

export function filterHexAssets(
  assets: HexAssetEntry[],
  category: string,
  searchQuery: string
): HexAssetEntry[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  return assets.filter((item) => {
    const matchesCategory = category === 'all' || item.category === category;
    if (!matchesCategory) return false;
    if (!normalizedQuery) return true;
    return (
      item.name.toLowerCase().includes(normalizedQuery) ||
      item.file.toLowerCase().includes(normalizedQuery) ||
      item.category.toLowerCase().includes(normalizedQuery)
    );
  });
}

export function getCategoryCounts(assets: HexAssetEntry[]): Record<string, number> {
  const counts: Record<string, number> = { all: assets.length };
  for (const item of assets) {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
  }
  return counts;
}
