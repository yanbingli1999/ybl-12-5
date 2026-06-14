import { create } from 'zustand';
import type {
  BattleState, BattleRecord, BattleLogEntry,
  Enemy, ReplayData, ReplayAction, BoardingLoot
} from '../types';
import { getRandomEnemy, generateEnemyIntent } from '../data/enemies';
import { useShipStore } from './useShipStore';
import { useDiceStore } from './useDiceStore';
import { useConfigStore } from './useConfigStore';
import {
  executePlayerActions,
  executeEnemyIntent,
  checkBattleEnd,
  calculateReward,
} from '../utils/battle';
import {
  initializeBoardingForBattle,
  advanceBoardingTurn,
  processCounterAttack,
  processBoardingAttack,
  applySectionEffects,
  checkEnemySurrender,
  applyLootReward,
} from '../utils/boarding';
import { addBattleRecord, loadBattleHistory, updateStats } from '../utils/storage';
import { unassignAllDice } from '../utils/dice';

interface GameState {
  battleState: BattleState | null;
  battleHistory: BattleRecord[];
  currentDifficulty: number;
  replayData: ReplayData | null;
  replayIndex: number;
  isReplaying: boolean;
  replaySpeed: number;
  
  startBattle: () => void;
  confirmTurn: () => void;
  fleeBattle: () => void;
  endBattle: (result: 'victory' | 'defeat' | 'fled') => void;
  addLog: (log: BattleLogEntry) => void;
  loadHistory: () => void;
  startReplay: (recordId: string) => void;
  nextReplayStep: () => void;
  prevReplayStep: () => void;
  stopReplay: () => void;
  setReplaySpeed: (speed: number) => void;
  setDifficulty: (difficulty: number) => void;
  resetBattle: () => void;
  attackBoardingSection: (sectionId: string, damage: number) => void;
  claimBoardingLoot: (lootId: string) => void;
}

export const useGameStore = create<GameState>((set, get) => ({
  battleState: null,
  battleHistory: [],
  currentDifficulty: 1,
  replayData: null,
  replayIndex: -1,
  isReplaying: false,
  replaySpeed: 1,
  
  startBattle: () => {
    const { currentDifficulty } = get();
    const shipStore = useShipStore.getState();
    const config = useConfigStore.getState().config;

    shipStore.applyUpgradeEffects();
    const player = { ...shipStore.ship };
    player.hp = player.maxHp;
    player.shield = player.maxShield;
    player.energy = player.maxEnergy;
    player.cabins = player.cabins.map(c => ({ ...c, damaged: false, cooldown: 0 }));

    const enemy = getRandomEnemy(currentDifficulty);
    const boardingState = initializeBoardingForBattle(enemy, config);
    
    const battleState: BattleState = {
      id: `battle_${Date.now()}`,
      turn: 1,
      phase: 'player',
      player,
      enemy,
      logs: [{
        id: `log_${Date.now()}_start`,
        turn: 1,
        type: 'system',
        source: 'system',
        message: `战斗开始！遭遇 ${enemy.name}！`,
        timestamp: Date.now(),
      }],
      result: 'ongoing',
      startTime: Date.now(),
      rewardPoints: 0,
      boardingState,
    };
    
    const replayData: ReplayData = {
      initialState: JSON.parse(JSON.stringify(battleState)),
      actions: [],
    };
    
    set({ 
      battleState, 
      replayData,
      replayIndex: -1,
      isReplaying: false,
    });
    
    useDiceStore.getState().resetDice();
  },
  
  confirmTurn: () => {
    const { battleState, replayData } = get();
    if (!battleState || battleState.phase !== 'player') return;
    
    const diceStore = useDiceStore.getState();
    const config = useConfigStore.getState().config;
    const shipStore = useShipStore.getState();
    
    const { dice } = diceStore;
    const wasDefending = battleState.enemy.intent.type === 'defend';
    let originalDefense = battleState.enemy.defense;
    
    let preparedEnemy = { ...battleState.enemy };
    if (wasDefending) {
      preparedEnemy.defense = preparedEnemy.defense + 0.2;
    }
    
    let boardingState = { ...battleState.boardingState };
    boardingState.available = preparedEnemy.shield <= 0;

    const playerResult = executePlayerActions(
      dice,
      battleState.player,
      preparedEnemy,
      config,
      boardingState
    );

    if (playerResult.boardingProgress > 0) {
      boardingState.progress += playerResult.boardingProgress;
      boardingState.suppression = Math.min(100, boardingState.suppression + playerResult.boardingSuppression);

      const boardingLog: BattleLogEntry = {
        id: `log_${Date.now()}_boarding`,
        turn: battleState.turn,
        type: 'boarding',
        source: 'player',
        message: `登舰进度 +${playerResult.boardingProgress}，压制 +${playerResult.boardingSuppression}`,
        value: playerResult.boardingProgress,
        timestamp: Date.now(),
      };
      playerResult.logs.push(boardingLog);

      const damageFromProgress = playerResult.boardingProgress;
      if (boardingState.progress >= 100) {
        const undestroyedSections = boardingState.sections.filter(s => !s.destroyed);
        if (undestroyedSections.length > 0) {
          const targetSection = undestroyedSections[Math.floor(Math.random() * undestroyedSections.length)];
          const attackResult = processBoardingAttack(
            boardingState,
            targetSection.id,
            damageFromProgress,
            battleState.turn
          );
          boardingState = attackResult.newState;
          playerResult.logs.push(...attackResult.logs);

          if (attackResult.sectionDestroyed) {
            playerResult.newEnemy = applySectionEffects(playerResult.newEnemy, boardingState.sections);

            if (checkEnemySurrender(boardingState.sections)) {
              const surrenderLog: BattleLogEntry = {
                id: `log_${Date.now()}_surrender`,
                turn: battleState.turn,
                type: 'boarding',
                source: 'system',
                message: '🏳️ 敌舰已投降！',
                timestamp: Date.now(),
              };
              playerResult.logs.push(surrenderLog);
            }
          }
        }
        boardingState.progress = 0;
      }
    }
    
    let newState: BattleState = {
      ...battleState,
      player: playerResult.newPlayer,
      enemy: playerResult.newEnemy,
      boardingState,
      logs: [...battleState.logs, ...playerResult.logs.map(l => ({ ...l, turn: battleState.turn }))],
    };
    
    const result = checkBattleEnd(newState.player, newState.enemy);
    if (result !== 'ongoing' || checkEnemySurrender(newState.boardingState.sections)) {
      get().endBattle(result !== 'ongoing' ? result : 'victory');
      return;
    }
    
    newState.phase = 'enemy';

    if (newState.boardingState.counterAttackPending) {
      const counterResult = processCounterAttack(
        newState.boardingState,
        newState.player,
        config,
        battleState.turn
      );
      newState.boardingState = counterResult.newState;
      newState.player = counterResult.newPlayer;
      newState.logs = [...newState.logs, ...counterResult.logs.map(l => ({ ...l, turn: battleState.turn }))];
    }

    const shieldGenDestroyed = newState.boardingState.sections.find(s => s.type === 'shield_gen')?.destroyed;
    const repairBayDestroyed = newState.boardingState.sections.find(s => s.type === 'repair_bay')?.destroyed;
    
    if (newState.enemy.intent.type === 'repair' && !repairBayDestroyed) {
      const healAmount = newState.enemy.intent.value;
      newState.enemy = {
        ...newState.enemy,
        hp: Math.min(newState.enemy.maxHp, newState.enemy.hp + healAmount),
      };
    } else if (newState.enemy.intent.type === 'repair' && repairBayDestroyed) {
      const blockedLog: BattleLogEntry = {
        id: `log_${Date.now()}_repair_blocked`,
        turn: battleState.turn,
        type: 'boarding',
        source: 'system',
        message: '维修舱已被摧毁，敌方无法维修！',
        timestamp: Date.now(),
      };
      newState.logs = [...newState.logs, blockedLog];
    }
    
    const enemyResult = executeEnemyIntent(
      newState.enemy,
      newState.player,
      config
    );
    
    if (newState.enemy.intent.type === 'special') {
      const abilityName = newState.enemy.intent.description.replace('准备释放 ', '');
      const ability = newState.enemy.abilities.find(a => a.name === abilityName && a.currentCooldown === 0);
      if (ability) {
        newState.enemy = {
          ...newState.enemy,
          abilities: newState.enemy.abilities.map(a => 
            a.id === ability.id ? { ...a, currentCooldown: a.cooldown } : a
          ),
        };
      }
    }
    
    let enemyHp = newState.player.hp;
    let enemyShield = newState.player.shield;
    
    if (enemyResult.effect === 'reduce_evasion') {
      newState.player = {
        ...newState.player,
        evasion: Math.max(0, newState.player.evasion - 0.1),
      };
    }
    
    if (enemyResult.effect === 'damage_cabin') {
      const undamagedCabins = newState.player.cabins.filter(c => !c.damaged);
      if (undamagedCabins.length > 0) {
        const randomCabin = undamagedCabins[Math.floor(Math.random() * undamagedCabins.length)];
        newState.player = {
          ...newState.player,
          cabins: newState.player.cabins.map(c => 
            c.id === randomCabin.id 
              ? { ...c, damaged: true, cooldown: config.repairCooldown }
              : c
          ),
        };
        enemyResult.logs.push({
          id: `log_${Date.now()}_cabin`,
          turn: battleState.turn,
          type: 'effect',
          source: 'enemy',
          message: `${randomCabin.name} 被损坏！`,
          timestamp: Date.now(),
        });
      }
    }
    
    if (enemyResult.effect === 'heal_hp') {
      const healAmount = Math.floor(newState.enemy.maxHp * 0.15);
      newState.enemy = {
        ...newState.enemy,
        hp: Math.min(newState.enemy.maxHp, newState.enemy.hp + healAmount),
      };
      enemyResult.logs.push({
        id: `log_${Date.now()}_heal`,
        turn: battleState.turn,
        type: 'heal',
        source: 'enemy',
        message: `敌方恢复 ${healAmount} HP`,
        value: healAmount,
        timestamp: Date.now(),
      });
    }
    
    if (enemyResult.effect === 'heal_shield') {
      if (shieldGenDestroyed) {
        const blockedLog: BattleLogEntry = {
          id: `log_${Date.now()}_shield_blocked`,
          turn: battleState.turn,
          type: 'boarding',
          source: 'system',
          message: '护盾发生器已被摧毁，敌方无法恢复护盾！',
          timestamp: Date.now(),
        };
        enemyResult.logs.push(blockedLog);
      } else {
        const shieldAmount = Math.floor(newState.enemy.maxShield * 0.3);
        newState.enemy = {
          ...newState.enemy,
          shield: Math.min(newState.enemy.maxShield, newState.enemy.shield + shieldAmount),
        };
        enemyResult.logs.push({
          id: `log_${Date.now()}_shield`,
          turn: battleState.turn,
          type: 'shield',
          source: 'enemy',
          message: `敌方恢复 ${shieldAmount} 护盾`,
          value: shieldAmount,
          timestamp: Date.now(),
        });
      }
    }
    
    enemyHp = enemyResult.newPlayerHp;
    enemyShield = enemyResult.newPlayerShield;
    
    newState = {
      ...newState,
      player: { ...newState.player, hp: enemyHp, shield: enemyShield },
      logs: [...newState.logs, ...enemyResult.logs.map(l => ({ ...l, turn: battleState.turn }))],
    };
    
    const finalResult = checkBattleEnd(newState.player, newState.enemy);
    if (finalResult !== 'ongoing') {
      get().endBattle(finalResult);
      return;
    }
    
    if (wasDefending) {
      newState.enemy = {
        ...newState.enemy,
        defense: originalDefense,
      };
    }

    // #region debug-point H4:defense-rollback
    fetch("http://127.0.0.1:7777/event",{method:"POST",body:JSON.stringify({sessionId:"battle-mechanics-bugs",runId:"pre-fix",hypothesisId:"H4",location:"useGameStore.ts:259",msg:"[DEBUG] Defense rollback",data:{wasDefending,defenseBeforeRollback:newState.enemy.defense,defenseAfterRollback:wasDefending?originalDefense:newState.enemy.defense,originalDefense,nextIntentWillBeGenerated:true},ts:Date.now()})}).catch(()=>{});
    // #endregion
    
    newState.enemy = generateEnemyIntent(newState.enemy);
    
    const boardingTurnResult = advanceBoardingTurn(
      newState.boardingState,
      newState.enemy,
      config,
      battleState.turn
    );
    newState.boardingState = boardingTurnResult.newState;
    newState.logs = [...newState.logs, ...boardingTurnResult.logs.map(l => ({ ...l, turn: battleState.turn }))];

    const playerEvasionReset = useShipStore.getState().ship.evasion;
    newState.player = {
      ...newState.player,
      evasion: playerEvasionReset,
    };
    
    newState.turn += 1;
    newState.phase = 'player';
    
    newState.player = {
      ...newState.player,
      energy: Math.min(newState.player.maxEnergy, newState.player.energy + Math.floor(newState.player.maxEnergy * 0.5)),
    };
    
    const replayAction: ReplayAction = {
      turn: battleState.turn,
      phase: 'player',
      action: 'turn',
      payload: { dice: JSON.parse(JSON.stringify(dice)) },
      resultingState: JSON.parse(JSON.stringify(newState)),
    };
    
    const newReplayData = replayData ? {
      ...replayData,
      actions: [...replayData.actions, replayAction],
    } : null;
    
    set({ 
      battleState: newState,
      replayData: newReplayData,
    });
    
    const newStats = {
      ...shipStore.stats,
      totalTurns: shipStore.stats.totalTurns + 1,
      totalDamageDealt: shipStore.stats.totalDamageDealt + playerResult.totalDamageDealt,
      totalDamageTaken: shipStore.stats.totalDamageTaken + (enemyResult.shieldResult.damage),
    };
    updateStats(newStats);
    shipStore.stats = newStats;
    
    diceStore.setDice(unassignAllDice(dice));
  },
  
  fleeBattle: () => {
    get().endBattle('fled');
  },
  
  endBattle: (result) => {
    const { battleState, replayData } = get();
    if (!battleState) return;
    
    const shipStore = useShipStore.getState();
    const config = useConfigStore.getState().config;
    
    let reward = result === 'victory'
      ? calculateReward(result, battleState.turn, get().currentDifficulty)
      : 0;

    let finalPlayer = { ...battleState.player };
    const unclaimedLoot = battleState.boardingState.loot.filter(l => !l.claimed);
    if (result === 'victory' && unclaimedLoot.length > 0) {
      for (const loot of unclaimedLoot) {
        const lootResult = applyLootReward(loot, finalPlayer);
        finalPlayer = lootResult.newPlayer;
        reward += lootResult.rewardPoints;
      }
    }
    
    const newState: BattleState = {
      ...battleState,
      player: finalPlayer,
      result,
      phase: 'ended',
      endTime: Date.now(),
      rewardPoints: reward,
      boardingState: {
        ...battleState.boardingState,
        loot: battleState.boardingState.loot.map(l => ({ ...l, claimed: true })),
      },
    };
    
    const newRecord: BattleRecord = {
      id: battleState.id,
      startTime: battleState.startTime,
      endTime: Date.now(),
      result,
      turns: battleState.turn,
      enemyType: battleState.enemy.type,
      enemyName: battleState.enemy.name,
      playerHpRemaining: battleState.player.hp,
      enemyHpRemaining: battleState.enemy.hp,
      replayData: replayData || { initialState: newState, actions: [] },
      rewardEarned: reward,
    };
    
    addBattleRecord(newRecord);
    
    if (reward > 0) {
      shipStore.addRewardPoints(reward);
    }
    
    const newStats = { ...shipStore.stats };
    newStats.totalBattles += 1;
    
    if (result === 'victory') {
      newStats.victories += 1;
      newStats.currentStreak += 1;
      newStats.longestStreak = Math.max(newStats.longestStreak, newStats.currentStreak);
    } else {
      newStats.defeats += 1;
      newStats.currentStreak = 0;
    }
    
    updateStats(newStats);
    shipStore.stats = newStats;
    
    set({ 
      battleState: newState,
      battleHistory: [newRecord, ...get().battleHistory],
    });
  },

  addLog: (log) => {
    const { battleState } = get();
    if (!battleState) return;
    
    set({
      battleState: {
        ...battleState,
        logs: [...battleState.logs, log],
      },
    });
  },
  
  loadHistory: () => {
    const history = loadBattleHistory();
    set({ battleHistory: history });
  },
  
  startReplay: (recordId) => {
    const { battleHistory } = get();
    const record = battleHistory.find(r => r.id === recordId);
    if (!record) return;
    
    set({
      replayData: record.replayData,
      replayIndex: -1,
      isReplaying: true,
      battleState: JSON.parse(JSON.stringify(record.replayData.initialState)),
    });
  },
  
  nextReplayStep: () => {
    const { replayData, replayIndex } = get();
    if (!replayData || replayIndex >= replayData.actions.length - 1) return;
    
    const nextIndex = replayIndex + 1;
    const action = replayData.actions[nextIndex];
    
    set({
      replayIndex: nextIndex,
      battleState: JSON.parse(JSON.stringify(action.resultingState)),
    });
  },
  
  prevReplayStep: () => {
    const { replayData, replayIndex } = get();
    if (!replayData || replayIndex <= 0) {
      if (replayIndex === 0) {
        set({
          replayIndex: -1,
          battleState: JSON.parse(JSON.stringify(replayData.initialState)),
        });
      }
      return;
    }
    
    const prevIndex = replayIndex - 1;
    const action = replayData.actions[prevIndex];
    
    set({
      replayIndex: prevIndex,
      battleState: JSON.parse(JSON.stringify(action.resultingState)),
    });
  },
  
  stopReplay: () => {
    set({
      replayData: null,
      replayIndex: -1,
      isReplaying: false,
      battleState: null,
    });
  },
  
  setReplaySpeed: (speed) => {
    set({ replaySpeed: speed });
  },
  
  setDifficulty: (difficulty) => {
    set({ currentDifficulty: difficulty });
  },
  
  attackBoardingSection: (sectionId: string, damage: number) => {
    const { battleState } = get();
    if (!battleState || battleState.phase !== 'player') return;
    if (!battleState.boardingState.available) return;
    if (battleState.boardingState.progress < 100) return;

    const attackResult = processBoardingAttack(
      battleState.boardingState,
      sectionId,
      damage,
      battleState.turn
    );

    let newEnemy = battleState.enemy;
    if (attackResult.sectionDestroyed) {
      newEnemy = applySectionEffects(newEnemy, attackResult.newState.sections);
    }

    const newState: BattleState = {
      ...battleState,
      enemy: newEnemy,
      boardingState: {
        ...attackResult.newState,
        progress: 0,
      },
      logs: [
        ...battleState.logs,
        ...attackResult.logs.map(l => ({ ...l, turn: battleState.turn })),
      ],
    };

    if (checkEnemySurrender(newState.boardingState.sections)) {
      set({ battleState: newState });
      get().endBattle('victory');
      return;
    }

    set({ battleState: newState });
  },

  claimBoardingLoot: (lootId: string) => {
    const { battleState } = get();
    if (!battleState) return;

    const loot = battleState.boardingState.loot.find(l => l.id === lootId);
    if (!loot || loot.claimed) return;

    const shipStore = useShipStore.getState();
    const result = applyLootReward(loot, battleState.player);

    const newState: BattleState = {
      ...battleState,
      player: result.newPlayer,
      boardingState: {
        ...battleState.boardingState,
        loot: battleState.boardingState.loot.map(l =>
          l.id === lootId ? { ...l, claimed: true } : l
        ),
      },
      logs: [
        ...battleState.logs,
        {
          id: `log_${Date.now()}_loot_claim`,
          turn: battleState.turn,
          type: 'boarding',
          source: 'player',
          message: `🎁 领取战利品：${result.message}`,
          timestamp: Date.now(),
        },
      ],
    };

    if (result.rewardPoints > 0) {
      shipStore.addRewardPoints(result.rewardPoints);
    }

    set({ battleState: newState });
  },

  resetBattle: () => {
    set({
      battleState: null,
      replayData: null,
      replayIndex: -1,
      isReplaying: false,
    });
    useDiceStore.getState().resetDice();
  },
}));
