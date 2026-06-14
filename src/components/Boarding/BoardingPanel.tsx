import React from 'react';
import { Shield, AlertTriangle, Target, Users, Package, Swords, Lock } from 'lucide-react';
import { useGameStore } from '../../store/useGameStore';
import { useConfigStore } from '../../store/useConfigStore';
import { getSectionIcon } from '../../utils/boarding';
import type { BoardingLoot, EnemySection } from '../../types';

export const BoardingPanel: React.FC = () => {
  const { battleState, claimBoardingLoot, attackBoardingSection } = useGameStore();
  const { config } = useConfigStore();

  if (!battleState) return null;

  const { boardingState, enemy } = battleState;
  const isAvailable = boardingState.available;
  const netAlert = Math.max(0, boardingState.alertLevel - boardingState.suppression);
  const isDangerZone = netAlert >= config.boardingCounterAttackThreshold;

  const handleAttackSection = (section: EnemySection) => {
    if (boardingState.progress < 100 || section.destroyed) return;
    attackBoardingSection(section.id, boardingState.progress);
  };

  const handleClaimLoot = (loot: BoardingLoot) => {
    if (loot.claimed) return;
    claimBoardingLoot(loot.id);
  };

  const getLootIcon = (type: string) => {
    switch (type) {
      case 'reward_points': return '💰';
      case 'energy_cell': return '⚡';
      case 'cabin_repair': return '🔧';
      default: return '🎁';
    }
  };

  const getLootColor = (type: string) => {
    switch (type) {
      case 'reward_points': return 'text-neon-yellow';
      case 'energy_cell': return 'text-neon-cyan';
      case 'cabin_repair': return 'text-neon-green';
      default: return 'text-gray-400';
    }
  };

  if (!isAvailable) {
    return (
      <div className="glass-panel neon-border p-4 rounded-xl">
        <div className="flex items-center justify-center gap-2 text-gray-500">
          <Lock className="w-5 h-5" />
          <span className="font-display">敌方护盾未击穿，登舰系统待机中</span>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel neon-border border-neon-orange/50 p-4 rounded-xl">
      <h3 className="text-lg font-display font-bold text-neon-orange mb-3 flex items-center gap-2">
        <Swords className="w-5 h-5" />
        登舰突击
      </h3>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-space-900/50 p-3 rounded-lg">
          <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">
            <Target className="w-3 h-3" />
            登舰进度
          </div>
          <div className="h-3 bg-space-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-neon-orange to-neon-red transition-all duration-300"
              style={{ width: `${Math.min(100, boardingState.progress)}%` }}
            />
          </div>
          <div className="text-right text-sm font-display font-bold text-neon-orange mt-1">
            {boardingState.progress}%
          </div>
        </div>

        <div className="bg-space-900/50 p-3 rounded-lg">
          <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">
            <Users className="w-3 h-3" />
            突击队
          </div>
          <div className="text-2xl font-display font-bold text-neon-blue">
            {boardingState.assaultTeamSize}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-space-900/50 p-3 rounded-lg">
          <div className={`flex items-center gap-1 text-xs mb-1 ${isDangerZone ? 'text-neon-red' : 'text-gray-400'}`}>
            <AlertTriangle className="w-3 h-3" />
            警戒值
          </div>
          <div className="h-3 bg-space-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isDangerZone
                  ? 'bg-gradient-to-r from-neon-red to-red-600 animate-pulse'
                  : 'bg-gradient-to-r from-yellow-600 to-neon-yellow'
              }`}
              style={{ width: `${netAlert}%` }}
            />
          </div>
          <div className={`text-right text-sm font-display font-bold mt-1 ${isDangerZone ? 'text-neon-red' : 'text-neon-yellow'}`}>
            {netAlert}%
          </div>
        </div>

        <div className="bg-space-900/50 p-3 rounded-lg">
          <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">
            <Shield className="w-3 h-3" />
            压制度
          </div>
          <div className="h-3 bg-space-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-neon-cyan to-neon-blue transition-all duration-300"
              style={{ width: `${Math.min(100, boardingState.suppression)}%` }}
            />
          </div>
          <div className="text-right text-sm font-display font-bold text-neon-cyan mt-1">
            {boardingState.suppression}
          </div>
        </div>
      </div>

      {boardingState.counterAttackPending && (
        <div className="mb-4 p-2 bg-neon-red/20 border border-neon-red/50 rounded-lg text-center animate-pulse">
          <span className="text-neon-red font-display font-bold text-sm">
            ⚠️ 警戒值过高！敌方即将反制！
          </span>
        </div>
      )}

      <div className="mb-4">
        <h4 className="text-sm font-display font-bold text-gray-300 mb-2 flex items-center gap-1">
          <Target className="w-4 h-4" />
          敌舰舱段
        </h4>
        <div className="space-y-2">
          {boardingState.sections.map((section) => (
            <div
              key={section.id}
              className={`
                p-3 rounded-lg border transition-all
                ${section.destroyed
                  ? 'bg-space-900/30 border-gray-700 opacity-60'
                  : boardingState.progress >= 100
                    ? 'bg-neon-orange/10 border-neon-orange/50 hover:border-neon-orange cursor-pointer'
                    : 'bg-space-900/50 border-space-600'
                }
              `}
              onClick={() => handleAttackSection(section)}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{getSectionIcon(section.type)}</span>
                  <span className={`font-display font-bold ${section.destroyed ? 'text-gray-500 line-through' : 'text-white'}`}>
                    {section.name}
                  </span>
                </div>
                {section.destroyed ? (
                  <span className="text-xs text-neon-green">✓ 已摧毁</span>
                ) : boardingState.progress >= 100 ? (
                  <span className="text-xs text-neon-orange animate-pulse">🎯 可攻击</span>
                ) : null}
              </div>
              {!section.destroyed && (
                <>
                  <div className="h-2 bg-space-700 rounded-full overflow-hidden mb-1">
                    <div
                      className="h-full bg-gradient-to-r from-neon-red to-neon-orange transition-all"
                      style={{ width: `${(section.hp / section.maxHp) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">{section.hp} / {section.maxHp}</span>
                    <span className="text-neon-yellow">💰 +{section.lootReward}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{section.effectDescription}</p>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {boardingState.loot.length > 0 && (
        <div>
          <h4 className="text-sm font-display font-bold text-gray-300 mb-2 flex items-center gap-1">
            <Package className="w-4 h-4" />
            战利品
          </h4>
          <div className="space-y-2">
            {boardingState.loot.map((loot) => (
              <div
                key={loot.id}
                className={`
                  p-2 rounded-lg border flex items-center justify-between transition-all
                  ${loot.claimed
                    ? 'bg-space-900/30 border-gray-700 opacity-50'
                    : 'bg-neon-yellow/10 border-neon-yellow/50 hover:border-neon-yellow cursor-pointer'
                  }
                `}
                onClick={() => handleClaimLoot(loot)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{getLootIcon(loot.type)}</span>
                  <span className={`font-display ${loot.claimed ? 'text-gray-500 line-through' : getLootColor(loot.type)}`}>
                    {loot.name} +{loot.value}
                  </span>
                </div>
                {!loot.claimed && (
                  <span className="text-xs text-neon-yellow">点击领取</span>
                )}
                {loot.claimed && (
                  <span className="text-xs text-gray-500">已领取</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 text-xs text-gray-500 text-center">
        {boardingState.progress >= 100
          ? '⚔️ 登舰完成！点击敌舰舱段进行攻击'
          : '🎲 分配骰子到登舰舱以积累进度'}
      </div>
    </div>
  );
};
