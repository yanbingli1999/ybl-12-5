import type {
  EnemySection,
  EnemySectionType,
  BoardingState,
  BoardingLoot,
  BattleLogEntry,
  Enemy,
  Ship,
  CabinType,
  GameConfig,
} from '../types';

interface SectionTemplate {
  type: EnemySectionType;
  name: string;
  effectDescription: string;
  baseLoot: number;
  icon: string;
}

const sectionTemplates: SectionTemplate[] = [
  {
    type: 'weapon_bay',
    name: '武器舱',
    effectDescription: '摧毁后敌方攻击力-30%',
    baseLoot: 8,
    icon: '⚔️',
  },
  {
    type: 'shield_gen',
    name: '护盾发生器',
    effectDescription: '摧毁后敌方无法恢复护盾',
    baseLoot: 10,
    icon: '🛡️',
  },
  {
    type: 'engine_room',
    name: '引擎室',
    effectDescription: '摧毁后敌方闪避率-50%',
    baseLoot: 8,
    icon: '🚀',
  },
  {
    type: 'repair_bay',
    name: '维修舱',
    effectDescription: '摧毁后敌方无法进行维修',
    baseLoot: 10,
    icon: '🔧',
  },
  {
    type: 'cargo_hold',
    name: '货舱',
    effectDescription: '掠夺后获得额外奖励点数',
    baseLoot: 15,
    icon: '📦',
  },
  {
    type: 'bridge',
    name: '舰桥',
    effectDescription: '占领后敌舰直接投降',
    baseLoot: 20,
    icon: '🎯',
  },
];

export function createEnemySections(enemyType: string, baseHp: number, config: GameConfig): EnemySection[] {
  const sectionCount = enemyType === 'boss' ? 6 : enemyType === 'cruiser' ? 5 : enemyType === 'fighter' || enemyType === 'raider' ? 4 : 3;

  const availableTypes: EnemySectionType[] = ['weapon_bay', 'shield_gen', 'engine_room', 'repair_bay', 'cargo_hold', 'bridge'];
  const shuffled = [...availableTypes].sort(() => Math.random() - 0.5).slice(0, sectionCount);

  if (!shuffled.includes('cargo_hold')) {
    shuffled[Math.floor(Math.random() * shuffled.length)] = 'cargo_hold';
  }

  const hpMultiplier = enemyType === 'boss' ? 1.5 : enemyType === 'cruiser' ? 1.2 : 1;

  return shuffled.map((type, index) => {
    const template = sectionTemplates.find(t => t.type === type)!;
    const hp = Math.floor((config.boardingSectionHpBase + baseHp * 0.1) * hpMultiplier);
    return {
      id: `section_${type}_${index}_${Date.now()}`,
      type,
      name: template.name,
      hp,
      maxHp: hp,
      destroyed: false,
      effectDescription: template.effectDescription,
      lootReward: Math.floor(template.baseLoot * hpMultiplier),
    };
  });
}

export function createInitialBoardingState(): BoardingState {
  return {
    available: false,
    progress: 0,
    alertLevel: 0,
    suppression: 0,
    sections: [],
    assaultTeamSize: 3,
    loot: [],
    counterAttackPending: false,
  };
}

export function initializeBoardingForBattle(
  enemy: Enemy,
  config: GameConfig
): BoardingState {
  const state = createInitialBoardingState();
  state.available = enemy.shield <= 0;
  state.sections = createEnemySections(enemy.type, enemy.maxHp, config);
  return state;
}

export function calculateBoardingProgress(
  points: number,
  boardingLevel: number,
  config: GameConfig
): number {
  const levelMultiplier = 1 + (boardingLevel - 1) * 0.25;
  return Math.floor(points * config.boardingProgressPerPoint * levelMultiplier);
}

export function calculateSuppression(
  points: number,
  boardingLevel: number,
  config: GameConfig
): number {
  const levelMultiplier = 1 + (boardingLevel - 1) * 0.2;
  return Math.floor(points * config.boardingSuppressionPerPoint * levelMultiplier);
}

function createLog(
  source: 'player' | 'enemy' | 'system',
  type: BattleLogEntry['type'],
  message: string,
  value?: number,
  turn: number = 1
): BattleLogEntry {
  return {
    id: `log_boarding_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    turn,
    type,
    source,
    message,
    value,
    timestamp: Date.now(),
  };
}

function generateLoot(section: EnemySection): BoardingLoot[] {
  const loot: BoardingLoot[] = [];

  loot.push({
    id: `loot_${section.id}_reward`,
    name: '战利品点数',
    type: 'reward_points',
    value: section.lootReward,
    claimed: false,
  });

  if (section.type === 'cargo_hold' && Math.random() < 0.5) {
    loot.push({
      id: `loot_${section.id}_energy`,
      name: '能量电池',
      type: 'energy_cell',
      value: 3,
      claimed: false,
    });
  }

  if (section.type === 'repair_bay' && Math.random() < 0.4) {
    loot.push({
      id: `loot_${section.id}_repair`,
      name: '维修套件',
      type: 'cabin_repair',
      value: 1,
      claimed: false,
    });
  }

  return loot;
}

export function processBoardingAttack(
  state: BoardingState,
  sectionId: string,
  damage: number,
  turn: number
): {
  newState: BoardingState;
  logs: BattleLogEntry[];
  sectionDestroyed: boolean;
  destroyedSection?: EnemySection;
} {
  const logs: BattleLogEntry[] = [];
  const newState = { ...state, sections: [...state.sections] };
  let sectionDestroyed = false;
  let destroyedSection: EnemySection | undefined;

  const sectionIndex = newState.sections.findIndex(s => s.id === sectionId);
  if (sectionIndex === -1) {
    return { newState, logs, sectionDestroyed };
  }

  const section = { ...newState.sections[sectionIndex] };
  if (section.destroyed) {
    logs.push(createLog('system', 'boarding', `${section.name} 已经被摧毁`, undefined, turn));
    return { newState, logs, sectionDestroyed };
  }

  const effectiveDamage = Math.max(1, damage);
  section.hp = Math.max(0, section.hp - effectiveDamage);

  logs.push(createLog('player', 'boarding', `突击队攻击 ${section.name}，造成 ${effectiveDamage} 点伤害`, effectiveDamage, turn));

  if (section.hp <= 0) {
    section.destroyed = true;
    sectionDestroyed = true;
    destroyedSection = section;

    logs.push(createLog('player', 'boarding', `✅ ${section.name} 已被占领/摧毁！`, undefined, turn));

    const newLoot = generateLoot(section);
    newState.loot = [...newState.loot, ...newLoot];

    logs.push(createLog('player', 'boarding', `获得 ${newLoot.length} 件战利品！`, newLoot.length, turn));
  }

  newState.sections[sectionIndex] = section;

  return { newState, logs, sectionDestroyed, destroyedSection };
}

export function applySectionEffects(
  enemy: Enemy,
  sections: EnemySection[]
): Enemy {
  let newEnemy = { ...enemy };

  const weaponBay = sections.find(s => s.type === 'weapon_bay');
  if (weaponBay?.destroyed) {
    newEnemy.attack = Math.floor(newEnemy.attack * 0.7);
  }

  const engineRoom = sections.find(s => s.type === 'engine_room');
  if (engineRoom?.destroyed) {
    newEnemy.evasion = Math.max(0, newEnemy.evasion * 0.5);
  }

  return newEnemy;
}

export function checkEnemySurrender(sections: EnemySection[]): boolean {
  const bridge = sections.find(s => s.type === 'bridge');
  if (bridge?.destroyed) return true;

  const destroyedCount = sections.filter(s => s.destroyed).length;
  return destroyedCount >= Math.ceil(sections.length * 0.7);
}

export function processCounterAttack(
  state: BoardingState,
  player: Ship,
  config: GameConfig,
  turn: number
): {
  newState: BoardingState;
  newPlayer: Ship;
  logs: BattleLogEntry[];
  damagedCabin?: CabinType;
} {
  const logs: BattleLogEntry[] = [];
  const newState = { ...state };
  let newPlayer = { ...player };
  let damagedCabin: CabinType | undefined;

  if (state.alertLevel < config.boardingCounterAttackThreshold) {
    return { newState, newPlayer, logs };
  }

  newState.counterAttackPending = false;

  const assaultLoss = Math.min(state.assaultTeamSize, Math.ceil(state.alertLevel / 30));
  newState.assaultTeamSize = Math.max(0, state.assaultTeamSize - assaultLoss);
  logs.push(createLog('enemy', 'boarding', `⚠️ 敌方反制！突击队损失 ${assaultLoss} 人`, assaultLoss, turn));

  const undamagedCabins = player.cabins.filter(c => !c.damaged);
  if (undamagedCabins.length > 0 && Math.random() < 0.6) {
    const randomCabin = undamagedCabins[Math.floor(Math.random() * undamagedCabins.length)];
    newPlayer = {
      ...newPlayer,
      cabins: newPlayer.cabins.map(c =>
        c.id === randomCabin.id
          ? { ...c, damaged: true, cooldown: config.repairCooldown }
          : c
      ),
    };
    damagedCabin = randomCabin.type;
    logs.push(createLog('enemy', 'boarding', `💥 ${randomCabin.name} 被敌方破坏！`, undefined, turn));
  }

  newState.alertLevel = Math.max(0, state.alertLevel - 30);

  return { newState, newPlayer, logs, damagedCabin };
}

export function advanceBoardingTurn(
  state: BoardingState,
  enemy: Enemy,
  config: GameConfig,
  turn: number
): {
  newState: BoardingState;
  logs: BattleLogEntry[];
} {
  const logs: BattleLogEntry[] = [];
  const newState = { ...state };

  newState.available = enemy.shield <= 0;

  if (newState.available && newState.progress > 0) {
    newState.alertLevel = Math.min(100, newState.alertLevel + config.boardingAlertPerTurn);
    newState.suppression = Math.max(0, newState.suppression - 5);

    const netAlert = Math.max(0, newState.alertLevel - newState.suppression);
    if (netAlert >= config.boardingCounterAttackThreshold) {
      newState.counterAttackPending = true;
      logs.push(createLog('system', 'boarding', `🔴 警戒值过高！敌方即将反制！`, netAlert, turn));
    }

    logs.push(createLog('system', 'boarding', `登舰状态 - 警戒: ${netAlert}%  压制: ${newState.suppression}`, undefined, turn));
  }

  return { newState, logs };
}

export function applyLootReward(
  loot: BoardingLoot,
  player: Ship
): {
  newPlayer: Ship;
  rewardPoints: number;
  message: string;
} {
  let newPlayer = { ...player };
  let rewardPoints = 0;
  let message = '';

  switch (loot.type) {
    case 'reward_points':
      rewardPoints = loot.value;
      message = `获得 ${loot.value} 奖励点数`;
      break;
    case 'energy_cell':
      newPlayer.energy = Math.min(newPlayer.maxEnergy, newPlayer.energy + loot.value);
      message = `能量 +${loot.value}`;
      break;
    case 'cabin_repair':
      const damagedCabins = newPlayer.cabins.filter(c => c.damaged);
      if (damagedCabins.length > 0) {
        const cabinToRepair = damagedCabins[0];
        newPlayer.cabins = newPlayer.cabins.map(c =>
          c.id === cabinToRepair.id
            ? { ...c, damaged: false, cooldown: 0 }
            : c
        );
        message = `${cabinToRepair.name} 已修复`;
      } else {
        rewardPoints = 5;
        message = `无损坏舱室，转换为 5 奖励点数`;
      }
      break;
  }

  return { newPlayer, rewardPoints, message };
}

export function getSectionIcon(type: EnemySectionType): string {
  const template = sectionTemplates.find(t => t.type === type);
  return template?.icon || '❓';
}
