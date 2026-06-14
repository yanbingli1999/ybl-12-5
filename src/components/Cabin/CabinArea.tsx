import React from 'react';
import { useDiceStore } from '../../store/useDiceStore';
import { useShipStore } from '../../store/useShipStore';
import { useGameStore } from '../../store/useGameStore';
import { CabinSlot } from './CabinSlot';
import type { CabinType } from '../../types';

interface CabinAreaProps {
  disabled?: boolean;
}

export const CabinArea: React.FC<CabinAreaProps> = ({ disabled }) => {
  const { dice, assignDie } = useDiceStore();
  const { ship } = useShipStore();
  const { battleState } = useGameStore();

  const enemyShieldEmpty = battleState ? battleState.enemy.shield <= 0 : false;

  const handleDrop = (cabinType: CabinType, dieId: string) => {
    if (cabinType === 'boarding' && !enemyShieldEmpty) return;
    assignDie(dieId, cabinType);
  };

  const handleRemoveDie = (dieId: string) => {
    assignDie(dieId, null);
  };

  const getDiceForCabin = (cabinType: CabinType) => {
    return dice.filter(d => d.assignedTo === cabinType);
  };

  const getTotalPoints = (cabinType: CabinType) => {
    return getDiceForCabin(cabinType).reduce((sum, d) => sum + d.value, 0);
  };

  const isCabinDisabled = (cabinType: CabinType) => {
    if (disabled) return true;
    if (cabinType === 'boarding' && !enemyShieldEmpty) return true;
    return false;
  };

  const cabinOrder: CabinType[] = ['engine', 'shield', 'weapon', 'repair', 'scanner', 'boarding'];

  return (
    <div className="glass-panel neon-border p-6 rounded-xl">
      <h3 className="text-xl font-display font-bold text-neon-blue mb-4">舱位分配</h3>
      
      <div className="space-y-3">
        {cabinOrder.map(cabinType => {
          const cabin = ship.cabins.find(c => c.type === cabinType);
          if (!cabin) return null;
          
          return (
            <CabinSlot
              key={cabin.id}
              cabin={cabin}
              assignedDice={getDiceForCabin(cabinType)}
              totalPoints={getTotalPoints(cabinType)}
              onDrop={handleDrop}
              onRemoveDie={handleRemoveDie}
              disabled={isCabinDisabled(cabinType)}
              boardingLocked={cabinType === 'boarding' && battleState !== null && !enemyShieldEmpty}
            />
          );
        })}
      </div>

      <p className="text-center text-xs text-gray-500 mt-4">
        将骰子拖放到对应舱位来分配点数，点击已分配的骰子可收回
      </p>
      {battleState && !enemyShieldEmpty && (
        <p className="text-center text-xs text-neon-orange mt-2">
          💡 击穿敌方护盾后可启用登舰舱
        </p>
      )}
    </div>
  );
};
