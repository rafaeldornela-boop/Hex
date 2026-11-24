export interface ArchitectureSystem {
  id: string;
  title: string;
  files: string[];
  summary: string;
  details: string[];
  technicalNote?: string;
  jumpToScript?: string;
}

export interface SceneTreeNode {
  name: string;
  type: string;
  depth: number;
  role: string;
}

export interface ReadingOrderStep {
  step: string;
  file: string;
  reason: string;
  scriptPath?: string;
}

export const SCENE_TREE_NODES: SceneTreeNode[] = [
  {
    name: 'Main',
    type: 'Node3D',
    depth: 0,
    role: 'Nó raiz da cena principal (res://scenes/main.tscn).',
  },
  {
    name: 'Builder',
    type: 'Node3D',
    depth: 1,
    role: 'Executa scripts/builder.gd e recebe o array exportado com os 72 recursos Hexagon.',
  },
  {
    name: 'Selector',
    type: 'Node3D',
    depth: 2,
    role: 'Cursor 3D posicionado no centro do hexágono sob o mouse.',
  },
  {
    name: 'Sprite',
    type: 'Sprite3D',
    depth: 3,
    role: 'Anel visual do cursor usando sprites/selector.png.',
  },
  {
    name: 'Container',
    type: 'Node3D',
    depth: 3,
    role: 'Guarda a pré-visualização 3D da peça atual e gira em passos de 60°.',
  },
  {
    name: 'View',
    type: 'Node3D',
    depth: 1,
    role: 'Pivô da câmera controlado por scripts/view.gd.',
  },
  {
    name: 'Camera',
    type: 'Camera3D',
    depth: 2,
    role: 'Câmera usada para renderização e raycast do cursor no plano Y=0.',
  },
  {
    name: 'GridMap',
    type: 'GridMap',
    depth: 1,
    role: 'Resquício do template quadrado do Kenney (ainda referenciado em action_demolish).',
  },
  {
    name: 'Sun',
    type: 'DirectionalLight3D',
    depth: 1,
    role: 'Iluminação direcional principal combinada com scenes/main-environment.tres.',
  },
  {
    name: 'CanvasLayer',
    type: 'CanvasLayer',
    depth: 1,
    role: 'Camada de HUD 2D sobreposta ao mundo 3D.',
  },
  {
    name: 'Control',
    type: 'Control',
    depth: 2,
    role: 'Contêiner da interface com Debug (Label), CashIcon (TextureRect) e Cash (Label).',
  },
  {
    name: 'Hexagons',
    type: 'Node3D',
    depth: 1,
    role: 'Contêiner onde cada hexágono construído é instanciado como filho com nome baseado em cube_coords.',
  },
];

export const ARCHITECTURE_SYSTEMS: ArchitectureSystem[] = [
  {
    id: 'main-scene',
    title: '01. Cena Principal',
    files: ['scenes/main.tscn', 'scenes/main-environment.tres', 'project.godot'],
    summary:
      'Definida em project.godot como run/main_scene="res://scenes/main.tscn". Reúne a árvore 3D, a câmera, a iluminação, o HUD e o catálogo de 72 peças.',
    details: [
      'O nó Builder conecta via node_paths as referências de Selector, Container, Hexagons, Camera, GridMap, Cash e Debug.',
      'O ambiente 3D (céu e iluminação global) fica em scenes/main-environment.tres.',
      'Nota: o repositório original contém 4 arquivos temporários antigos em scenes/ (mai*.tmp), preservados sem modificação.',
    ],
  },
  {
    id: 'main-scripts',
    title: '02. Scripts Principais',
    files: [
      'scripts/builder.gd',
      'scripts/view.gd',
      'scripts/hexagon.gd',
      'scripts/data_map.gd',
      'scripts/data_structure.gd',
    ],
    summary:
      'A lógica principal é enxuta e distribuída em apenas 5 scripts próprios mais a biblioteca auxiliar de grade hexagonal (2 scripts).',
    details: [
      'builder.gd concentra o loop principal de interação (cursor, construir, rotacionar, trocar peça, dinheiro e salvar/carregar).',
      'view.gd isola totalmente a movimentação e rotação da câmera.',
      'hexagon.gd, data_map.gd e data_structure.gd definem tipos de dados usando Resource + class_name.',
    ],
    jumpToScript: 'scripts/builder.gd',
  },
  {
    id: 'hex-grid',
    title: '03. Sistema de Mapa e Hexágonos',
    files: [
      'scripts/godot-gdhexgrid/HexGrid.gd',
      'scripts/godot-gdhexgrid/HexCell.gd',
    ],
    summary:
      'Usa a biblioteca godot-gdhexgrid (hexágonos flat-topped) para converter posições contínuas 3D em coordenadas hexagonais discretas.',
    details: [
      'HexGrid.get_hex_at(world_position) converte um Vector2 (x, z) do mundo na célula HexCell correspondente.',
      'HexGrid.get_hex_center3(...) devolve o centro 3D exato da célula para alinhar o cursor e os modelos.',
      'HexCell oferece coordenadas cúbicas (cube_coords), axiais (axial_coords), offset e busca de vizinhos (get_adjacent) — excelente base para futuras mecânicas de território.',
    ],
    jumpToScript: 'scripts/godot-gdhexgrid/HexGrid.gd',
  },
  {
    id: 'building',
    title: '04. Sistema de Construção',
    files: ['scripts/builder.gd'],
    summary:
      'Ao clicar (ação "build"), builder.gd instancia o PackedScene do hexágono selecionado dentro do nó Main/Hexagons e deduz o preço do saldo.',
    details: [
      'get_node_string(...) gera um identificador único a partir de cube_coords para nomear cada nó filho em hexagons_container.',
      'Se já existir um hexágono naquela coordenada, o nó anterior é removido com queue_free() antes de instanciar o novo.',
      'create_hexagon(...) posiciona o modelo no centro do hex, aplica selector_rotation no eixo Y e grava o índice em metadata ("index").',
    ],
    technicalNote:
      'Observação importante da inspeção: action_demolish (tecla DEL) ainda chama gridmap.set_cell_item(hexgrid_position, -1), um resquício da conversão do GridMap quadrado original. Como não alteramos gameplay nesta etapa, isso foi preservado intacto e será um ótimo primeiro exercício de correção.',
    jumpToScript: 'scripts/builder.gd',
  },
  {
    id: 'tile-selection',
    title: '05. Sistema de Seleção de Tiles',
    files: ['scripts/builder.gd', 'sprites/selector.png'],
    summary:
      'A cada frame (_process), um raio da câmera intersecta o plano horizontal Y=0 para descobrir em qual hexágono o mouse está apontando.',
    details: [
      'plane = Plane(Vector3.UP, Vector3.ZERO) recebe o raycast gerado por view_camera.project_ray_origin e project_ray_normal.',
      'O nó Selector acompanha suavemente o centro do hexágono sob o mouse, exibindo o preview 3D elevado em +0.25 no eixo Y.',
      'Botão direito gira o preview em 60° (action_rotate) e Q / E ou roda do mouse percorrem o array hexagons (action_structure_toggle).',
    ],
    jumpToScript: 'scripts/builder.gd',
  },
  {
    id: 'camera',
    title: '06. Sistema de Câmera',
    files: ['scripts/view.gd'],
    summary:
      'Anexado ao nó View (pai da Camera3D), aplica interpolação suave (lerp) tanto na translação quanto na rotação orbital.',
    details: [
      'WASD calcula um vetor de entrada rotacionado pelo ângulo Y atual da câmera para mover na direção relativa à visão.',
      'Segurar o botão do meio do mouse ("camera_rotate") gira camera_rotation no eixo Y conforme event.relative.x.',
      'A tecla F ("camera_center") retorna camera_position para Vector3(0, 0, 0).',
    ],
    jumpToScript: 'scripts/view.gd',
  },
  {
    id: 'save-load',
    title: '07. Sistema de Salvar e Carregar',
    files: [
      'scripts/builder.gd',
      'scripts/data_map.gd',
      'scripts/data_structure.gd',
      'sample map/map.res',
    ],
    summary:
      'Persiste o estado completo do mapa usando o sistema nativo ResourceSaver / ResourceLoader do Godot em "user://map.res".',
    details: [
      'F1 (action_save) percorre os filhos de hexagons_container, cria um DataStructure (position, orientation, structure) para cada hex e salva DataMap em user://map.res.',
      'F2 (action_load) limpa hexagons_container, carrega user://map.res e recria cada hexágono com sua rotação original.',
      'O projeto inclui sample map/map.res como exemplo pronto de mapa salvo.',
    ],
    jumpToScript: 'scripts/data_map.gd',
  },
  {
    id: 'assets-buildings',
    title: '08. Prédios e Recursos Visuais',
    files: [
      'hexagons/*.tres (72 arquivos)',
      'models/Hexagons/*.glb',
      'models/Hexagons/Textures/colormap.png',
      'sprites/',
      'fonts/lilita_one_regular.ttf',
    ],
    summary:
      'Cada prédio, terreno, rio, caminho ou unidade é definido por um arquivo .tres do tipo Hexagon que aponta para um modelo 3D .glb e um preço.',
    details: [
      'São 72 recursos .tres em hexagons/ (18 prédios, 16 caminhos, 14 rios, 8 unidades, 15 terrenos de grama/pedra/areia/água/terra e 1 ponte).',
      'Todos os modelos 3D em models/Hexagons/ compartilham a paleta models/Hexagons/Textures/colormap.png (assets CC0 do Kenney).',
      'Curiosidade encontrada: atualmente apenas bridge.tres tem price = 100; os outros 71 recursos estão com price = 0.',
    ],
    jumpToScript: 'scripts/hexagon.gd',
  },
];

export const READING_ORDER: ReadingOrderStep[] = [
  {
    step: '01',
    file: 'scenes/main.tscn',
    reason:
      'Abra no editor 3D do Godot primeiro para visualizar a hierarquia de nós (Main, Builder, Selector, View, Hexagons) e ver como os 72 recursos Hexagon estão conectados no Inspector.',
  },
  {
    step: '02',
    file: 'scripts/hexagon.gd',
    reason:
      'Tem apenas 8 linhas e mostra como o Godot usa Resource e class_name para transformar arquivos .tres em dados configuráveis no editor.',
    scriptPath: 'scripts/hexagon.gd',
  },
  {
    step: '03',
    file: 'scripts/view.gd',
    reason:
      'Script curto e isolado (40 linhas): ótimo para entender _process, Input.get_axis, _input e interpolação suave com lerp.',
    scriptPath: 'scripts/view.gd',
  },
  {
    step: '04',
    file: 'scripts/builder.gd',
    reason:
      'É o coração do projeto (196 linhas). Leia de cima para baixo acompanhando _ready, _process (raycast), action_build, create_hexagon e action_save/action_load.',
    scriptPath: 'scripts/builder.gd',
  },
  {
    step: '05',
    file: 'scripts/data_map.gd e scripts/data_structure.gd',
    reason:
      'Mostram em menos de 15 linhas como serializar o estado do jogo sem precisar escrever JSON manualmente.',
    scriptPath: 'scripts/data_map.gd',
  },
  {
    step: '06',
    file: 'scripts/godot-gdhexgrid/HexGrid.gd e HexCell.gd',
    reason:
      'Consulte por último quando quiser entender a matemática de coordenadas cúbicas/axiais ou implementar vizinhança e expansão territorial.',
    scriptPath: 'scripts/godot-gdhexgrid/HexCell.gd',
  },
];

export const CONTROLS_LIST = [
  { keys: 'W A S D', action: 'Mover a câmera no plano do mapa' },
  { keys: 'F', action: 'Centralizar a câmera na origem (0, 0, 0)' },
  { keys: 'Botão do meio + arrastar', action: 'Rotacionar a câmera horizontalmente' },
  { keys: 'Botão esquerdo', action: 'Construir / substituir o hexágono selecionado' },
  { keys: 'Botão direito', action: 'Rotacionar a peça selecionada em 60°' },
  { keys: 'Q / E ou roda do mouse', action: 'Alternar entre as 72 peças disponíveis' },
  { keys: 'DEL', action: 'Ação demolish mapeada no Input Map' },
  { keys: 'F1 / F2', action: 'Salvar e carregar mapa em user://map.res' },
];
