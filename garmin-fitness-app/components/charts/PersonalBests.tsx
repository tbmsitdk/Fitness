'use client';

import { PersonalBest } from '@/types';
import { Trophy, Activity, Bike, Footprints } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { clsx } from 'clsx';

interface Props {
  data: PersonalBest[];
}

const SPORT_ICON = {
  running: <Activity className="w-4 h-4" />,
  cycling: <Bike className="w-4 h-4" />,
  walking: <Footprints className="w-4 h-4" />,
};

const SPORT_COLORS = {
  running: 'bg-green-50 text-garmin-green border-green-100',
  cycling: 'bg-blue-50 text-garmin-blue border-blue-100',
  walking: 'bg-orange-50 text-garmin-orange border-orange-100',
};

export default function PersonalBests({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-slate-400 text-sm">
        No personal bests computed yet
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {data.map((pb, i) => {
        const sport = pb.activity_type as keyof typeof SPORT_COLORS;
        return (
          <div
            key={i}
            className={clsx(
              'p-3 rounded-xl border flex flex-col gap-1',
              SPORT_COLORS[sport] || 'bg-slate-50 text-slate-600 border-slate-100'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {SPORT_ICON[sport] || <Trophy className="w-4 h-4" />}
                <span className="text-xs font-medium opacity-75">{pb.activity_type}</span>
              </div>
              <Trophy className="w-3 h-3 opacity-50" />
            </div>
            <p className="text-lg font-bold leading-none">{pb.value}</p>
            <p className="text-xs opacity-75 leading-tight">{pb.label}</p>
            <p className="text-xs opacity-50 mt-0.5">
              {format(parseISO(pb.date), 'MMM d, yyyy')}
            </p>
          </div>
        );
      })}
    </div>
  );
}
