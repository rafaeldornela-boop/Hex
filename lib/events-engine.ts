export type KingdomEventKind =
  | 'good_harvest'
  | 'discovery'
  | 'trade_opportunity'
  | 'scarcity'
  | 'economic_crisis'
  | 'invasion';

export interface EventChoiceOption {
  id: string;
  labelPt: string;
  descriptionPt: string;
}

export interface ActiveKingdomEvent {
  id: string;
  turn: number;
  kind: KingdomEventKind;
  titlePt: string;
  descriptionPt: string;
  targetCoord?: { q: number; r: number };
  goldMultiplierMod?: number;
  foodMultiplierMod?: number;
  resolved: boolean;
  choices: EventChoiceOption[];
}

export interface EventHistoryEntry {
  turn: number;
  titlePt: string;
  outcomePt: string;
  kind: KingdomEventKind;
}

function deterministicEventPick(turn: number): number {
  const h = (turn * 2654435761) >>> 0;
  return h % 6;
}

/**
 * Generates periodic kingdom events every 3 turns starting from turn 3.
 */
export function generateTurnEvent(
  turn: number,
  borderTarget?: { q: number; r: number }
): ActiveKingdomEvent | null {
  if (turn < 3 || turn % 3 !== 0) return null;

  const pick = deterministicEventPick(turn);
  switch (pick) {
    case 0:
      return {
        id: `evt-${turn}-harvest`,
        turn,
        kind: 'good_harvest',
        titlePt: 'Boa Colheita',
        descriptionPt:
          'Chuvas favoráveis aceleraram as lavouras do reino. Há excedente imediato de alimentos.',
        foodMultiplierMod: 1.25,
        resolved: false,
        choices: [
          {
            id: 'store_food',
            labelPt: 'Estocar alimentos (+35 Alimento)',
            descriptionPt: 'Aumenta reservas para sustentar mais moradores.',
          },
          {
            id: 'sell_surplus',
            labelPt: 'Vender excedente (+160 Ouro)',
            descriptionPt: 'Converte a safra extra em moedas para o tesouro.',
          },
        ],
      };

    case 1:
      return {
        id: `evt-${turn}-discovery`,
        turn,
        kind: 'discovery',
        titlePt: 'Descoberta Mineral e Acadêmica',
        descriptionPt:
          'Exploradores encontraram veios superficiais e manuscritos antigos na fronteira.',
        resolved: false,
        choices: [
          {
            id: 'extract_minerals',
            labelPt: 'Extrair minérios (+25 Pedra, +20 Minério)',
            descriptionPt: 'Reforça o estoque para obras e armamento.',
          },
          {
            id: 'study_findings',
            labelPt: 'Estudar registros (+15 Ciência)',
            descriptionPt: 'Acelera imediatamente a pesquisa ativa.',
          },
        ],
      };

    case 2:
      return {
        id: `evt-${turn}-trade`,
        turn,
        kind: 'trade_opportunity',
        titlePt: 'Oportunidade Comercial',
        descriptionPt:
          'Uma caravana estrangeira oferece contrato lucrativo em troca de investimento inicial.',
        resolved: false,
        choices: [
          {
            id: 'invest_caravan',
            labelPt: 'Investir $120 (+280 Ouro e +20 Madeira)',
            descriptionPt: 'Lucro líquido garantido para o reino.',
          },
          {
            id: 'decline_caravan',
            labelPt: 'Recusar oferta',
            descriptionPt: 'Mantém o caixa atual sem compromisso.',
          },
        ],
      };

    case 3:
      return {
        id: `evt-${turn}-scarcity`,
        turn,
        kind: 'scarcity',
        titlePt: 'Escassez Sazonal',
        descriptionPt:
          'Um período seco reduziu temporariamente os suprimentos armazenados.',
        resolved: false,
        choices: [
          {
            id: 'import_grain',
            labelPt: 'Importar grãos (-$100 Ouro)',
            descriptionPt: 'Evita perda de alimentos e mantém a população estável.',
          },
          {
            id: 'ration_food',
            labelPt: 'Racionar estoques (-20 Alimento)',
            descriptionPt: 'Poupa ouro usando as reservas atuais.',
          },
        ],
      };

    case 4:
      return {
        id: `evt-${turn}-crisis`,
        turn,
        kind: 'economic_crisis',
        titlePt: 'Crise Econômica Regional',
        descriptionPt:
          'A queda nas rotas vizinhas pressiona a arrecadação deste ciclo.',
        goldMultiplierMod: 0.75,
        resolved: false,
        choices: [
          {
            id: 'stabilize_treasury',
            labelPt: 'Subsidiar mercadores (-$120, +10 Ciência)',
            descriptionPt: 'Transforma a crise em reforma administrativa.',
          },
          {
            id: 'absorb_crisis',
            labelPt: 'Enfrentar retração (-$80 Ouro)',
            descriptionPt: 'Impacto controlado nas contas do reino.',
          },
        ],
      };

    case 5:
    default:
      return {
        id: `evt-${turn}-invasion`,
        turn,
        kind: 'invasion',
        titlePt: 'Incursão de Saqueadores',
        descriptionPt:
          'Batedores inimigos avançam contra a fronteira do seu território!',
        targetCoord: borderTarget,
        resolved: false,
        choices: [
          {
            id: 'defend_borders',
            labelPt: 'Defender fronteira (usa força militar)',
            descriptionPt:
              'Se sua defesa total for ≥ 12, vence e ganha +$180; caso contrário perde $160.',
          },
          {
            id: 'pay_tribute',
            labelPt: 'Pagar tributo (-$140 Ouro)',
            descriptionPt: 'Evita combate direto na fronteira.',
          },
        ],
      };
  }
}
