import { useState } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { forceSync, recordBet } from '../services/api';
import type { DriverStats } from '../services/api';

interface PredictionFormProps {
  drivers: DriverStats[];
  onBetPlaced?: () => void;
}

const PredictionForm: React.FC<PredictionFormProps> = ({ drivers, onBetPlaced }) => {
  const { placeBet, account, raceInfo } = useWeb3();
  const [p1, setP1] = useState<string>('');
  const [p2, setP2] = useState<string>('');
  const [p3, setP3] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!p1 || !p2 || !p3) {
      alert("Please select all three podium positions.");
      return;
    }
    if (p1 === p2 || p1 === p3 || p2 === p3) {
      alert("Please select different drivers for each position.");
      return;
    }

    setIsSubmitting(true);
    try {
      const predictedNumbers = [parseInt(p1, 10), parseInt(p2, 10), parseInt(p3, 10)];
      const txHash = await placeBet(predictedNumbers);
      if (account && raceInfo?.raceId) {
        try {
          await recordBet({
            walletAddress: account,
            raceRound: raceInfo.raceId,
            predictedNumbers,
            txHash,
          });
        } catch (recordErr) {
          console.warn('Immediate bet record failed, falling back to sync', recordErr);
        }
        try {
          await forceSync();
        } catch (syncErr) {
          console.warn('Sync failed after bet, but bet was successful', syncErr);
        }
        onBetPlaced?.();
      }
    } catch (err) {
      console.error(err);
      alert("Failed to submit prediction. Check console for details.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="bg-[#15151E] border border-track-grey rounded-lg p-6 relative">
      <div className="absolute top-0 left-0 w-1 h-full bg-status-error"></div>
      <h3 className="font-headline-md text-headline-md uppercase text-f1-white mb-6 flex items-center gap-2">
        <span className="material-symbols-outlined text-status-error">sports_score</span>
        Lock In Podium
      </h3>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* P1 Slot */}
        <div className="relative group">
          <label className="absolute -top-2.5 left-3 bg-[#15151E] px-1 font-label-sm text-label-sm text-status-error uppercase z-10 font-bold">P1 Winner</label>
          <select 
            value={p1}
            onChange={(e) => setP1(e.target.value)}
            className="w-full bg-[#000000] border border-track-grey rounded p-4 pl-12 text-f1-white font-headline-md focus:border-status-error focus:ring-1 focus:ring-status-error outline-none appearance-none cursor-pointer transition-colors glow-active"
          >
            <option value="" disabled>Select Driver</option>
            {drivers.map(d => (
              <option key={d.driverId} value={d.permanentNumber}>{d.givenName} {d.familyName}</option>
            ))}
          </select>
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-status-error" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
          <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">expand_more</span>
        </div>

        {/* P2 Slot */}
        <div className="relative">
          <label className="absolute -top-2.5 left-3 bg-[#15151E] px-1 font-label-sm text-label-sm text-on-surface-variant uppercase z-10">P2 Runner Up</label>
          <select 
            value={p2}
            onChange={(e) => setP2(e.target.value)}
            className="w-full bg-[#000000] border border-track-grey rounded p-4 pl-12 text-f1-white font-headline-md focus:border-status-error focus:ring-1 focus:ring-status-error outline-none appearance-none cursor-pointer transition-colors"
          >
            <option value="" disabled>Select Driver</option>
            {drivers.map(d => (
              <option key={d.driverId} value={d.permanentNumber}>{d.givenName} {d.familyName}</option>
            ))}
          </select>
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">military_tech</span>
          <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">expand_more</span>
        </div>

        {/* P3 Slot */}
        <div className="relative mb-4">
          <label className="absolute -top-2.5 left-3 bg-[#15151E] px-1 font-label-sm text-label-sm text-on-surface-variant uppercase z-10">P3 Third Place</label>
          <select 
            value={p3}
            onChange={(e) => setP3(e.target.value)}
            className="w-full bg-[#000000] border border-track-grey rounded p-4 pl-12 text-f1-white font-headline-md focus:border-status-error focus:ring-1 focus:ring-status-error outline-none appearance-none cursor-pointer transition-colors"
          >
            <option value="" disabled>Select Driver</option>
            {drivers.map(d => (
              <option key={d.driverId} value={d.permanentNumber}>{d.givenName} {d.familyName}</option>
            ))}
          </select>
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">military_tech</span>
          <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">expand_more</span>
        </div>

        <div className="p-4 bg-black/40 border border-track-grey rounded mb-2">
          <div className="flex justify-between items-center mb-1">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Entry Fee</span>
            <span className="font-label-md text-label-md text-f1-white">0.01 ETH</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Est. Gas</span>
            <span className="font-label-md text-label-md text-f1-white">~0.0004 ETH</span>
          </div>
        </div>

        <button 
          disabled={isSubmitting}
          className="w-full bg-status-error text-f1-white font-headline-md text-headline-md uppercase py-4 rounded hover:bg-error-container active:scale-95 transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(241,16,63,0.4)] disabled:opacity-50"
        >
          {isSubmitting ? 'Processing...' : 'Submit Prediction'}
          <span className="material-symbols-outlined">send</span>
        </button>
      </form>
    </section>
  );
};

export default PredictionForm;
