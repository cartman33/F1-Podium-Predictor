import { useWeb3 } from '../context/Web3Context';
import type { DriverStats } from '../services/api';

interface ResultsCardProps {
  drivers: DriverStats[];
}

const ResultsCard: React.FC<ResultsCardProps> = ({ drivers }) => {
  const { userBet, actualResults, raceInfo, claimReward, totalPool } = useWeb3();

  const triggerCelebration = () => {
    const colors = ['#ff553d', '#FFB800', '#ffb4a7'];
    for (let i = 0; i < 150; i++) {
      let conf = document.createElement('div');
      conf.className = 'confetti-piece fixed top-[-10px] w-[10px] h-[20px] pointer-events-none z-[101]';
      conf.style.left = Math.random() * 100 + 'vw';
      conf.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      conf.style.animation = `fall ${Math.random() * 2 + 2}s linear forwards`;
      conf.style.animationDelay = `${Math.random() * 1}s`;
      if (Math.random() > 0.5) {
        conf.style.borderRadius = '50%';
        conf.style.width = '10px';
        conf.style.height = '10px';
      }
      document.body.appendChild(conf);
      setTimeout(() => conf.remove(), 4000);
    }
  };

  const handleClaim = async () => {
    if (!raceInfo) return;
    try {
      await claimReward(raceInfo.raceId);
      triggerCelebration();
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : '보상 수령에 실패했습니다.';
      alert(message);
    }
  };

  const getDriver = (id: number) => drivers.find(d => parseInt(d.permanentNumber) === id);

  const getPoints = (idx: number) => {
    if (!userBet || !actualResults) return 0;
    if (userBet.predictedIds[idx] === actualResults[idx]) {
      return idx === 0 ? 5 : idx === 1 ? 3 : 2;
    }
    return 0;
  };

  // [수정] 실제 정산 전이라도 화면에 점수를 합산해서 보여줌
  const totalCalculatedScore = (() => {
    if (!userBet || !actualResults) return 0;
    let s = 0;
    for (let i = 0; i < 3; i++) {
        if (userBet.predictedIds[i] === actualResults[i]) {
            s += (i === 0 ? 5 : i === 1 ? 3 : 2);
        }
    }
    return s;
  })();

  const currentScore = userBet?.score && userBet.score > 0 ? userBet.score : totalCalculatedScore;

  const winnersTotal = raceInfo?.winnersTotalScore ?? 0;
  const poolEth = parseFloat(totalPool || '0');
  const claimableEth =
    currentScore > 0 && winnersTotal > 0 && poolEth > 0
      ? (poolEth * currentScore) / winnersTotal
      : 0;

  const canClaim =
    !!userBet?.exists &&
    !userBet?.hasClaimed &&
    currentScore > 0 &&
    raceInfo?.state === 3 &&
    winnersTotal > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Left Column: Results Comparison */}
      <div className="lg:col-span-8 flex flex-col gap-6">
        <h3 className="font-headline-md text-f1-white border-b border-track-grey pb-2 uppercase">Official Classification vs Prediction</h3>
        <div className="space-y-4">
          {[0, 1, 2].map((idx) => {
            const official = getDriver(actualResults?.[idx] || 0);
            const predicted = getDriver(userBet?.predictedIds[idx] || 0);
            const isCorrect = userBet?.predictedIds[idx] === actualResults?.[idx];
            const colorClass = idx === 0 ? 'border-status-pending' : idx === 1 ? 'border-secondary-fixed' : 'border-outline';
            const textColorClass = idx === 0 ? 'text-status-pending' : idx === 1 ? 'text-secondary-fixed' : 'text-outline';
            const bgGradient = idx === 0 ? 'from-status-pending/10' : idx === 1 ? 'from-secondary-fixed/10' : 'from-outline/10';

            return (
              <div key={idx} className={`bg-[#15151E] border-l-4 ${colorClass} border-y border-r border-track-grey rounded p-4 flex flex-col md:flex-row justify-between items-center gap-4 relative overflow-hidden`}>
                <div className={`absolute inset-0 bg-gradient-to-r ${bgGradient} to-transparent pointer-events-none`}></div>
                <div className="flex items-center gap-6 w-full md:w-auto">
                  <span className={`font-display-lg ${textColorClass} w-12 text-center`}>P{idx+1}</span>
                  <div>
                    <span className="font-label-sm text-label-sm text-on-surface-variant block uppercase">Official Result</span>
                    <span className="font-headline-md text-f1-white uppercase">{official ? official.familyName.toUpperCase() : 'TBA'}</span>
                    <span className="font-label-md text-secondary block">{official?.teamName || '---'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4 border-t md:border-t-0 md:border-l border-track-grey pt-4 md:pt-0 md:pl-6 w-full md:w-auto justify-between md:justify-start">
                  <div>
                    <span className="font-label-sm text-label-sm text-on-surface-variant block uppercase">Your Prediction</span>
                    <span className={`font-headline-md uppercase flex items-center gap-2 ${isCorrect ? textColorClass : 'text-status-error'}`}>
                      {predicted ? predicted.familyName.toUpperCase() : 'NONE'}
                      <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                        {isCorrect ? 'check_circle' : 'cancel'}
                      </span>
                    </span>
                  </div>
                  <span className={`font-stats-number px-3 py-1 rounded ${isCorrect ? `${textColorClass} bg-current/20` : 'text-track-grey bg-track-grey/20'}`}>
                    +{getPoints(idx)} PTS
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Column: Reward Claim */}
      <div className="lg:col-span-4 flex flex-col gap-6">
        <div className="bg-[#15151E] border border-primary rounded p-6 shadow-[0_0_15px_rgba(255,85,61,0.2)]">
          <h3 className="font-headline-md text-f1-white uppercase mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">account_balance</span>
            Prize Pool Allocation
          </h3>
          <div className="bg-carbon-black rounded border border-track-grey p-4 mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="font-label-sm text-label-sm text-on-surface-variant">Base Pool Share</span>
              <span className="font-label-md text-f1-white">0.01 ETH</span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <span className="font-label-sm text-label-sm text-on-surface-variant">Your Score</span>
              <span className="font-label-md text-status-pending">{currentScore} pts</span>
            </div>
            <div className="h-px w-full bg-track-grey my-3"></div>
            <div className="flex justify-between items-center">
              <span className="font-label-md text-label-md text-primary uppercase">Total Claimable</span>
              <span className="font-stats-number text-display-lg text-primary">
                {claimableEth.toFixed(4)} <span className="text-headline-md">ETH</span>
              </span>
            </div>
          </div>
          {winnersTotal <= 0 && raceInfo?.state === 3 && (
            <p className="font-label-sm text-status-error text-center mb-4">
              온체인 총 점수가 0으로 기록되어 있습니다. 운영자가 결과를 다시 확정해야 보상을 받을 수 있습니다.
            </p>
          )}
          <button 
            onClick={handleClaim}
            disabled={!canClaim}
            className="w-full bg-primary hover:bg-primary-container text-carbon-black font-headline-md py-4 rounded uppercase tracking-wider transition-colors flex justify-center items-center gap-2 active:scale-95 shadow-[0_0_10px_rgba(255,85,61,0.5)] disabled:opacity-30 disabled:grayscale"
          >
            {userBet?.hasClaimed ? 'Reward Claimed' : 'Claim Reward'}
            <span className="material-symbols-outlined">{userBet?.hasClaimed ? 'check_circle' : 'payments'}</span>
          </button>
          <p className="font-label-sm text-label-sm text-on-surface-variant text-center mt-4">
            Requires Sepolia ETH for gas fees.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ResultsCard;
