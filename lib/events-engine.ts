export type KingdomEventKind =
  | 'good_harvest'
  | 'drought'
  | 'discovery'
  | 'trade_opportunity'
  | 'epidemic'
  | 'economic_crisis'
  | 'revolt'
  | 'tech_breakthrough'
  | 'invasion';

export interface ActiveWorldEffect {
  id: string;
  titlePt: string;
  descriptionPt: string;
  turnsRemaining: number;
  goldMultiplierMod?: number;
  foodMultiplierMod?: number;
  scienceBonusPerTurn?: number;
  populationDeltaPerTurn?: number;
  efficiencyPenalty?: number;
}

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
  if (turn === 3) return 0;
  const h = (turn * 2654435761) >>> 0;
  return h % 9;
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
        id: `evt-${turn}-drought`,
        turn,
        kind: 'drought',
        titlePt: 'Seca Severa',
        descriptionPt:
          'A falta de chuvas ameaça reduzir em 30% a produção agrícola durante 3 turnos.',
        resolved: false,
        choices: [
          {
            id: 'irrigate_fields',
            labelPt: 'Investir $500 em irrigação',
            descriptionPt: 'Constrói canais emergenciais e protege a safra nos próximos 3 turnos.',
          },
          {
            id: 'accept_drought',
            labelPt: 'Aceitar a perda (-30% Alimento por 3 turnos)',
            descriptionPt: 'Poupa o tesouro agora, mas reduz a colheita por 3 turnos.',
          },
        ],
      };

    case 1:
      return {
        id: `evt-${turn}-harvest`,
        turn,
        kind: 'good_harvest',
        titlePt: 'Boa Colheita',
        descriptionPt:
          'Chuvas favoráveis aceleraram as lavouras do reino. Há excedente imediato de alimentos.',
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

    case 2:
      return {
        id: `evt-${turn}-discovery`,
        turn,
        kind: 'discovery',
        titlePt: 'Descoberta de Minério',
        descriptionPt:
          'Mineradores localizaram um veio rico nas encostas da fronteira.',
        resolved: false,
        choices: [
          {
            id: 'extract_minerals',
            labelPt: 'Extrair minérios (+25 Pedra, +20 Minério)',
            descriptionPt: 'Reforça o estoque para obras e armamento.',
          },
          {
            id: 'study_findings',
            labelPt: 'Estudar amostras (+15 Ciência)',
            descriptionPt: 'Acelera imediatamente a pesquisa ativa.',
          },
        ],
      };

    case 3:
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

    case 4:
      return {
        id: `evt-${turn}-epidemic`,
        turn,
        kind: 'epidemic',
        titlePt: 'Epidemia na Vila',
        descriptionPt:
          'Uma febre atingiu os bairros operários, ameaçando trabalhadores e eficiência por 2 turnos.',
        resolved: false,
        choices: [
          {
            id: 'fund_healers',
            labelPt: 'Financiar boticários (-$240 Ouro)',
            descriptionPt: 'Contém o surto imediatamente sem perder moradores.',
          },
          {
            id: 'quarantine_only',
            labelPt: 'Isolar bairros (-15% eficiência por 2 turnos)',
            descriptionPt: 'Evita gastos imediatos, mas reduz produtividade e população.',
          },
        ],
      };

    case 5:
      return {
        id: `evt-${turn}-crisis`,
        turn,
        kind: 'economic_crisis',
        titlePt: 'Crise Econômica Regional',
        descriptionPt:
          'A queda nas rotas vizinhas pressiona a arrecadação por 2 turnos.',
        resolved: false,
        choices: [
          {
            id: 'stabilize_treasury',
            labelPt: 'Subsidiar mercadores (-$140, +10 Ciência)',
            descriptionPt: 'Estabiliza a economia e evita retração prolongada.',
          },
          {
            id: 'absorb_crisis',
            labelPt: 'Enfrentar retração (-20% Ouro por 2 turnos)',
            descriptionPt: 'Preserva caixa imediato com arrecadação menor.',
          },
        ],
      };

    case 6:
      return {
        id: `evt-${turn}-revolt`,
        turn,
        kind: 'revolt',
        titlePt: 'Revolta Local',
        descriptionPt:
          'Comerciantes e camponeses protestam contra os impostos na fronteira.',
        resolved: false,
        choices: [
          {
            id: 'tax_relief',
            labelPt: 'Conceder alívio fiscal (-$180 Ouro)',
            descriptionPt: 'Acalma os moradores e mantém a produção normal.',
          },
          {
            id: 'suppress_revolt',
            labelPt: 'Conter com a guarda (exige Defesa ≥ 14)',
            descriptionPt: 'Guarda forte pacifica sem custos; defesa baixa gera greve de 2 turnos.',
          },
        ],
      };

    case 7:
      return {
        id: `evt-${turn}-breakthrough`,
        turn,
        kind: 'tech_breakthrough',
        titlePt: 'Descoberta Tecnológica',
        descriptionPt:
          'Estudiosos propõem um salto prático para acelerar os laboratórios do reino.',
        resolved: false,
        choices: [
          {
            id: 'sponsor_academy',
            labelPt: 'Patrocinar experimentos (-$180, +22 Ciência)',
            descriptionPt: 'Impulso imediato para concluir pesquisas avançadas.',
          },
          {
            id: 'sell_manuscripts',
            labelPt: 'Comercializar tratados (+$140, +6 Ciência)',
            descriptionPt: 'Gera receita imediata com avanço científico moderado.',
          },
        ],
      };

    case 8:
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
