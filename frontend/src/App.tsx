import { useState, useEffect } from 'react';
import { useWeb3 } from './context/Web3Context';
import { getDriversWithStats, getNextRace } from './services/api';
import type { DriverStats } from './services/api';
import DriverTable from './components/DriverTable';
import PredictionForm from './components/PredictionForm';
import ResultsCard from './components/ResultsCard';
import AdminPanel from './components/AdminPanel';

function App() {
  const { account, owner, raceInfo, userBet, isAdmin, totalPool, connectWallet, loading } = useWeb3();
  const [drivers, setDrivers] = useState<DriverStats[]>([]);
  const [nextRace, setNextRace] = useState<any>(null);
  const [view, setView] = useState<'welcome' | 'predict' | 'results' | 'admin'>('welcome');
  const [timeLeft, setTimeLeft] = useState<{d: string, h: string, m: string}>({ d: '--', h: '--', m: '--' });

  const fetchData = async () => {
    try {
      const [driversData, raceData] = await Promise.all([
        getDriversWithStats(),
        getNextRace(raceInfo?.raceId && raceInfo.raceId > 0 ? raceInfo.raceId : undefined)
      ]);
      setDrivers(driversData);
      setNextRace(raceData);
    } catch (err) {
      console.error("데이터 로드 실패:", err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 경기 ID나 상태가 변경되면 데이터를 다시 불러옴
  useEffect(() => {
    if (raceInfo?.raceId) {
      // 오라클 동기화 시간을 고려해 약간의 지연 후 호출
      const timeout = setTimeout(fetchData, 2000);
      return () => clearTimeout(timeout);
    }
  }, [raceInfo?.raceId, raceInfo?.state]);

  // 다른 사용자 베팅 시 픽률 갱신 (분석 페이지)
  useEffect(() => {
    if (view !== 'predict' || raceInfo?.state !== 1) return;
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [view, raceInfo?.state, raceInfo?.raceId]);

  useEffect(() => {
    if (account && view === 'welcome') {
      if (raceInfo?.state === 3) setView('results'); // 3: ENDED
      else setView('predict');
    } else if (!account && view !== 'welcome') {
      setView('welcome');
    }
  }, [account, raceInfo?.state]);

  // [리뷰어 주석 해결: 베팅 마감시간(온체인) 또는 다음 경기의 공식 마감시간(API)을 기반으로 남은 시간 카운트다운 로직 추가]
  useEffect(() => {
    const updateTimer = () => {
      let targetTime = 0;
      if (raceInfo?.state === 1 && raceInfo.deadline) {
        targetTime = raceInfo.deadline * 1000;
      } else if (nextRace && nextRace.date) {
        let dateStr = nextRace.date;
        if (typeof dateStr === 'string' && dateStr.includes('T')) {
          dateStr = dateStr.split('T')[0];
        } else if (typeof dateStr === 'object' && dateStr.toISOString) {
          dateStr = dateStr.toISOString().split('T')[0];
        }
        const timeStr = nextRace.time || '00:00:00';
        const timeWithZ = timeStr.endsWith('Z') ? timeStr : `${timeStr}Z`;
        targetTime = new Date(`${dateStr}T${timeWithZ}`).getTime();
      }

      if (targetTime === 0) return;

      const now = Date.now();
      const diff = targetTime - now;

      if (diff <= 0) {
        setTimeLeft({ d: '00', h: '00', m: '00' });
      } else {
        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const m = Math.floor((diff / 1000 / 60) % 60);
        setTimeLeft({
          d: d.toString().padStart(2, '0'),
          h: h.toString().padStart(2, '0'),
          m: m.toString().padStart(2, '0')
        });
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 60000);
    return () => clearInterval(interval);
  }, [raceInfo?.state, raceInfo?.deadline, nextRace]);

  if (loading) return (
    <div className="min-h-screen bg-carbon-black flex flex-col items-center justify-center font-display-lg text-primary text-2xl">
      <div className="animate-pulse mb-4 tracking-[0.2em]">LOADING TELEMETRY...</div>
      <div className="w-80 h-1 bg-track-grey rounded-full overflow-hidden">
        <div className="h-full bg-status-error animate-progress"></div>
      </div>
    </div>
  );

  const renderWelcome = () => (
    <main className="flex-grow pt-32 pb-24 flex flex-col items-center relative overflow-hidden bg-pattern w-full">
      {/* Dynamic Background */}
      <div className="absolute inset-0 z-0 opacity-30 pointer-events-none">
        <img alt="Hero background" className="w-full h-full object-cover scale-105" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAlW2_XBz24eJazOjd5TkuWe3chTv1VAcs6lk2GqIquqZFULvHKS8dfdhmyn2U2UsbTyNKHpTOTAVIgykgKJ7TEfEWc8WND5DYf5TL-piVfbAZtO1MFianresbxuAq6O0mbmbdmuV5OMdGNX9i5M7s2JoSr4RxWhXS67_c86lcU71hcjFRcuBSr8z8xH26hEvn-UlHNZj4CZXmt4v4-TzyA9D_FqXAqp2dX7uL-kBmCmkcDzOExPEOxFFoT1asWxEceYkLGfoefBbI" />
        <div className="absolute inset-0 bg-gradient-to-t from-carbon-black via-carbon-black/60 to-transparent"></div>
        <div className="absolute inset-0 hero-glow"></div>
      </div>

      <div className="max-w-container-max mx-auto px-margin-desktop w-full z-10 flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-3 px-6 py-2 rounded-full border border-track-grey bg-secondary-container/30 backdrop-blur-xl mb-10">
          <span className="material-symbols-outlined text-status-live animate-pulse" style={{ fontSize: '18px', fontVariationSettings: "'FILL' 1" }}>fiber_manual_record</span>
          <span className="font-label-md text-label-md uppercase tracking-[0.3em] text-f1-white">Live Telemetry Active</span>
        </div>

        <h1 className="font-display-lg text-[84px] leading-[0.95] md:text-[120px] font-extrabold uppercase mb-8 max-w-6xl tracking-tighter">
          Predict the <span className="text-status-error italic">Podium.</span><br/>
          Claim the <span className="text-status-error italic">Glory.</span>
        </h1>
        
        <p className="font-body-lg text-xl md:text-2xl text-on-surface-variant mb-16 max-w-3xl leading-relaxed">
          High-stakes, decentralized motorsport predictions powered by real-time Sepolia telemetry. Secure your stake, outsmart the grid, and take home the jackpot.
        </p>

        {/* Hero Jackpot Card */}
        <div className="mb-20 relative group scale-125">
          <div className="absolute -inset-2 bg-status-error rounded-xl blur-2xl opacity-10 group-hover:opacity-20 transition duration-1000"></div>
          <div className="relative jackpot-card rounded-xl px-16 py-10 flex flex-col items-center min-w-[400px]">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-[0.2em] mb-4">Current Jackpot</span>
            <div className="flex items-baseline gap-4">
              <span className="font-display-lg text-[96px] leading-none font-extrabold f1-gradient-text">{totalPool}</span>
              <span className="font-headline-md text-3xl text-status-error">ETH</span>
            </div>
          </div>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 w-full max-w-5xl mb-24">
          <div className="glass-panel p-8 rounded-xl flex flex-col items-center gap-4 transition-transform hover:scale-105">
            <div className="w-14 h-14 rounded-lg bg-white/5 flex items-center justify-center mb-2">
              <span className="material-symbols-outlined text-status-error text-3xl">analytics</span>
            </div>
            <h3 className="font-headline-md text-2xl text-f1-white">1. Predict Podium</h3>
            <p className="text-on-surface-variant leading-relaxed">Lock in your exact 1-2-3 finish before the race deadline begins.</p>
          </div>
          <div className="glass-panel p-8 rounded-xl flex flex-col items-center gap-4 transition-transform hover:scale-105">
            <div className="w-14 h-14 rounded-lg bg-white/5 flex items-center justify-center mb-2">
              <span className="material-symbols-outlined text-status-error text-3xl">account_balance_wallet</span>
            </div>
            <h3 className="font-headline-md text-2xl text-f1-white">2. Stake 0.01 ETH</h3>
            <p className="text-on-surface-variant leading-relaxed">Secure your prediction with a decentralized smart contract transaction.</p>
          </div>
          <div className="glass-panel p-8 rounded-xl flex flex-col items-center gap-4 transition-transform hover:scale-105">
            <div className="w-14 h-14 rounded-lg bg-white/5 flex items-center justify-center mb-2">
              <span className="material-symbols-outlined text-status-error text-3xl">emoji_events</span>
            </div>
            <h3 className="font-headline-md text-2xl text-f1-white">3. Claim Rewards</h3>
            <p className="text-on-surface-variant leading-relaxed">Win the pot if your exact podium prediction is correct. Instant payout.</p>
          </div>
        </div>

        <button onClick={connectWallet} className="bg-status-error text-f1-white font-headline-lg text-3xl uppercase px-20 py-6 rounded-lg active:scale-95 transition-all hover:bg-status-error/90 flex items-center gap-4 shadow-[0_0_40px_rgba(255,24,1,0.4)] group">
          <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform" style={{ fontVariationSettings: "'FILL' 1", fontSize: '32px' }}>login</span>
          Connect MetaMask to Start
        </button>
      </div>
    </main>
  );

  const renderPredict = () => (
    <main className="flex-1 flex flex-col min-h-screen bg-carbon-black relative">
      <div className="absolute inset-0 bg-pattern opacity-50 pointer-events-none"></div>
      <div className="flex-1 p-8 md:p-margin-desktop max-w-container-max mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-10 z-10 pt-36">
        <div className="lg:col-span-8 flex flex-col gap-10">
          {nextRace ? (
            <section className="glass-panel border border-white/5 p-10 rounded-2xl relative overflow-hidden carbon-texture glow-active">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-status-error"></div>
              <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-8">
                <div>
                  <p className="font-label-md text-label-md text-status-live uppercase flex items-center gap-3 mb-3">
                    <span className="w-3 h-3 rounded-full bg-status-live animate-pulse"></span> Next Grand Prix
                  </p>
                  <h2 className="font-display-lg text-6xl md:text-7xl font-extrabold uppercase text-f1-white m-0 leading-none">
                    {nextRace.raceName}
                  </h2>
                  <p className="font-body-lg text-2xl text-on-surface-variant mt-4 opacity-80">
                    {nextRace.circuitName || "TBA"}
                  </p>
                </div>
                <div className="flex gap-6 text-center">
                  <div className="bg-black/60 border border-white/10 rounded-xl p-5 min-w-[100px] backdrop-blur-md">
                    <div className="font-stats-number text-5xl font-bold text-f1-white">{timeLeft.d}</div>
                    <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mt-2 tracking-widest">Days</div>
                  </div>
                  <div className="bg-black/60 border border-white/10 rounded-xl p-5 min-w-[100px] backdrop-blur-md">
                    <div className="font-stats-number text-5xl font-bold text-f1-white">{timeLeft.h}</div>
                    <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mt-2 tracking-widest">Hrs</div>
                  </div>
                  <div className="bg-black/60 border border-white/10 rounded-xl p-5 min-w-[100px] backdrop-blur-md">
                    <div className="font-stats-number text-5xl font-bold text-f1-white">{timeLeft.m}</div>
                    <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mt-2 tracking-widest">Min</div>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <section className="glass-panel border border-dashed border-white/10 p-10 rounded-2xl flex flex-col items-center justify-center text-center">
                <span className="material-symbols-outlined text-5xl text-on-surface-variant mb-4">hourglass_top</span>
                <h2 className="font-display-lg text-5xl font-extrabold uppercase text-on-surface-variant m-0 leading-none">
                  PREPARING FOR BETTING
                </h2>
                <p className="font-body-lg text-xl text-on-surface-variant mt-4 opacity-80">
                  Please wait for the operator to start the next race.
                </p>
            </section>
          )}
          <DriverTable drivers={drivers} />
        </div>
        <div className="lg:col-span-4 flex flex-col gap-10">
          <div className="glass-panel border border-white/5 rounded-2xl p-8 flex items-center justify-between shadow-xl">
            <div>
              <p className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 tracking-widest">Prediction Status</p>
              <p className={`font-headline-md text-3xl ${userBet?.exists ? 'text-status-live' : 'text-status-pending'}`}>
                {userBet?.exists ? 'SECURED ON-CHAIN' : 'GRID SLOT OPEN'}
              </p>
            </div>
            <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
              <span className="material-symbols-outlined text-3xl text-on-surface-variant" style={{ fontVariationSettings: userBet?.exists ? "'FILL' 1" : "" }}>
                {userBet?.exists ? 'verified' : 'pending'}
              </span>
            </div>
          </div>
          
          {raceInfo?.state === 1 && !userBet?.exists && (
            <PredictionForm drivers={drivers} onBetPlaced={fetchData} />
          )}
          
          {userBet?.exists && userBet.raceId === raceInfo?.raceId && (
             <section className="glass-panel border border-status-live/30 rounded-2xl p-8 relative shadow-2xl overflow-hidden">
                <div className="absolute top-0 left-0 w-2 h-full bg-status-live"></div>
                <h3 className="font-headline-md text-2xl text-f1-white mb-8 uppercase flex items-center gap-3">
                  <span className="material-symbols-outlined text-status-live">lock</span>
                  Your Locked Podium
                </h3>
                <div className="flex flex-col gap-6">
                  {userBet.predictedIds.map((pid, idx) => {
                    const d = drivers.find(drv => parseInt(drv.permanentNumber) === pid);
                    const driverImg = d?.imageUrl || "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23A0A0B0'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";
                    
                    return (
                      <div key={idx} className="flex justify-between items-center bg-white/5 p-4 rounded-xl border border-white/10 transition-all hover:bg-white/10 group">
                        <div className="flex items-center gap-4">
                          <span className="font-display-lg text-3xl text-status-error font-black w-10 text-center">P{idx+1}</span>
                          <div className="w-12 h-12 rounded-full border border-white/10 overflow-hidden bg-track-grey shadow-inner">
                            <img 
                              src={driverImg} 
                              alt={d?.familyName || 'Racer'} 
                              className="w-full h-full object-cover scale-110 translate-y-1"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.onerror = null; // 무한 루프 방지
                                target.src = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23A0A0B0'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";
                              }}
                            />
                          </div>
                          <span className="font-headline-md text-xl text-f1-white uppercase tracking-tight group-hover:text-status-live transition-colors">
                            {d ? d.familyName : `DRIVER ${pid}`}
                          </span>
                        </div>
                        <span className="material-symbols-outlined text-status-live opacity-0 group-hover:opacity-100 transition-opacity">check_circle</span>
                      </div>
                    );
                  })}
                </div>
             </section>
          )}

          <div className="glass-panel border border-white/5 p-6 rounded-xl text-center opacity-60 hover:opacity-100 transition-opacity">
            <p className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 tracking-widest">Active Operator</p>
            <p className="font-label-md text-label-md text-f1-white font-mono break-all px-4">{owner}</p>
          </div>
        </div>
      </div>
    </main>
  );

  // [수정] 온체인 스코어가 0이더라도 경기 결과가 나왔다면 로컬에서 계산하여 표시
  const displayScore = (() => {
    if (!userBet || !raceInfo || raceInfo.state !== 3) return 0;
    // 현재 온체인 경기 ID와 사용자 베팅 정보의 경기 ID가 일치하는지 확인
    if (userBet.raceId !== raceInfo.raceId) return 0;
    
    if (userBet.score > 0) return userBet.score;
    
    // 로컬 계산 로직
    let score = 0;
    const actual = raceInfo.actualResults;
    const pred = userBet.predictedIds;
    if (actual && actual.length === 3 && pred && pred.length === 3) {
      if (pred[0] === actual[0]) score += 5;
      if (pred[1] === actual[1]) score += 3;
      if (pred[2] === actual[2]) score += 2;
    }
    return score;
  })();

  const renderResults = () => (
    <main className="flex-1 flex flex-col min-h-screen bg-carbon-black pt-36 relative">
      <div className="absolute inset-0 bg-pattern opacity-50 pointer-events-none"></div>
      <div className="p-8 md:p-margin-desktop max-w-container-max mx-auto w-full flex flex-col gap-12 relative z-10">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-white/10 pb-10 gap-8">
          <div>
            <span className="inline-flex items-center gap-3 bg-white/5 px-5 py-2 rounded-full font-label-md text-label-md text-on-surface-variant uppercase mb-4 border border-white/10">
              <span className="w-3 h-3 rounded-full bg-status-live animate-pulse"></span>
              {nextRace?.raceName || "Grand Prix"} Classification
            </span>
            <h1 className="font-display-lg text-6xl md:text-7xl text-f1-white uppercase font-extrabold leading-none">Race Results & Rewards</h1>
            <p className="font-body-lg text-xl text-on-surface-variant mt-6 max-w-2xl">The official classification has been published. Review your predictions and claim your payout.</p>
          </div>
          <div className="text-right bg-white/5 p-8 rounded-2xl border border-white/10 flex flex-col items-end backdrop-blur-xl min-w-[300px]">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest mb-2">Final Performance Score</span>
            <span className="font-stats-number text-7xl font-extrabold text-status-pending">{displayScore}<span className="text-3xl text-on-surface-variant ml-2">/10</span></span>
            <span className="font-label-md text-label-md text-status-live uppercase tracking-[0.3em] mt-3">Telemetry Match</span>
          </div>
        </header>
        <ResultsCard drivers={drivers} />
      </div>
    </main>
  );

  const renderAdmin = () => (
    <main className="flex-1 p-8 md:p-margin-desktop max-w-container-max mx-auto w-full pt-36 min-h-screen bg-carbon-black relative">
      <div className="absolute inset-0 bg-pattern opacity-30 pointer-events-none"></div>
      <AdminPanel drivers={drivers} />
    </main>
  );

  return (
    <div className="min-h-screen bg-carbon-black flex flex-col lg:flex-row text-f1-white font-body-md overflow-x-hidden">
      {/* TopAppBar */}
      <header className="fixed top-0 w-full z-50 bg-carbon-black/80 backdrop-blur-2xl border-b border-white/5">
        <div className="flex justify-between items-center h-24 px-margin-desktop max-w-[1800px] mx-auto w-full">
          <div className="flex items-center gap-12">
            <div 
              className="font-display-lg text-3xl md:text-4xl font-black text-f1-white uppercase tracking-tighter cursor-pointer hover:text-status-error transition-colors"
              onClick={() => setView(account ? 'predict' : 'welcome')}
            >
              F1 <span className="text-status-error italic">PODIUM</span> PREDICTOR
            </div>
            {account && (
              <nav className="hidden xl:flex gap-10 h-full items-center">
                {['predict', 'results', 'admin'].map((v) => (
                  (v !== 'admin' || isAdmin) && (
                    <button 
                      key={v}
                      className={`hover:text-status-error transition-all py-2 font-label-md text-sm uppercase tracking-widest relative group ${view === v ? 'text-status-error font-bold' : 'text-on-surface-variant'}`}
                      onClick={() => setView(v as any)}
                    >
                      {v === 'predict' ? 'Analysis' : v === 'results' ? 'Rewards' : 'Operator'}
                      {view === v && <span className="absolute -bottom-2 left-0 w-full h-0.5 bg-status-error shadow-[0_0_10px_#FF1801]"></span>}
                    </button>
                  )
                ))}
              </nav>
            )}
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-3 font-label-md text-sm text-on-surface-variant uppercase tracking-widest bg-white/5 px-4 py-2 rounded-full border border-white/5">
              <span className="material-symbols-outlined text-status-live" style={{ fontVariationSettings: "'FILL' 1", fontSize: '16px' }}>fiber_manual_record</span>
              Sepolia Testnet
            </div>
            <button 
              onClick={connectWallet} 
              className={`flex items-center gap-3 font-headline-md text-lg uppercase px-8 py-3 rounded-lg active:scale-95 transition-all shadow-lg ${account ? 'bg-white/10 text-f1-white hover:bg-white/20' : 'bg-status-error text-f1-white hover:bg-status-error/90 shadow-status-error/20'}`}
            >
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>account_balance_wallet</span>
              {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : 'Connect Wallet'}
            </button>
          </div>
        </div>
      </header>

      {/* SideNavBar (Desktop Only) */}
      {account && view !== 'welcome' && (
        <aside className="h-full w-72 fixed left-0 top-0 hidden lg:flex flex-col bg-carbon-black border-r border-white/5 z-40 pt-24">
          <div className="flex flex-col py-12 gap-8 px-8 h-full">
            <div className="mb-4">
              <div className="font-display-lg text-2xl text-status-error mb-2 italic">Race Control</div>
              <div className="font-label-sm text-xs text-on-surface-variant flex items-center gap-2 uppercase tracking-widest">
                <span className={`w-2 h-2 rounded-full animate-pulse ${raceInfo?.state === 1 ? 'bg-status-live' : 'bg-status-pending'}`}></span>
                Status: {
                  !raceInfo || raceInfo.state === 0 ? 'WAITING' : 
                  raceInfo.state === 1 ? 'GRID OPEN' : 
                  raceInfo.state === 2 ? 'EARLY ENDED' : 'RACE ENDED'
                }
              </div>
            </div>
            <nav className="flex-1 flex flex-col gap-4">
              {[
                { id: 'predict', icon: 'analytics', label: 'Analysis' },
                { id: 'results', icon: 'emoji_events', label: 'Rewards' },
                ...(isAdmin ? [{ id: 'admin', icon: 'settings_applications', label: 'Operator' }] : [])
              ].map((item) => (
                <button 
                  key={item.id}
                  onClick={() => setView(item.id as any)} 
                  className={`flex items-center gap-4 px-6 py-4 rounded-xl transition-all cursor-pointer active:scale-95 font-label-md text-sm uppercase tracking-widest ${view === item.id ? 'bg-status-error text-f1-white shadow-lg shadow-status-error/20 font-bold' : 'text-on-surface-variant hover:bg-white/5 hover:text-f1-white'}`}
                >
                  <span className="material-symbols-outlined">{item.icon}</span> {item.label}
                </button>
              ))}
            </nav>
            <div className="mt-auto flex flex-col gap-6">
              <button className="w-full bg-transparent border border-white/10 text-on-surface-variant font-label-md text-xs uppercase tracking-widest py-4 hover:bg-white/5 hover:text-f1-white transition-all rounded-xl mb-4">
                View Live Telemetry
              </button>
              <div className="flex justify-between border-t border-white/5 pt-6 pb-4">
                <a href="#" className="text-on-surface-variant hover:text-status-error flex items-center gap-2 font-label-md text-xs uppercase tracking-tighter"><span className="material-symbols-outlined text-[18px]">description</span> Docs</a>
                <a href="#" className="text-on-surface-variant hover:text-status-error flex items-center gap-2 font-label-md text-xs uppercase tracking-tighter"><span className="material-symbols-outlined text-[18px]">help</span> Support</a>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Content Switcher */}
      <div className={`flex-1 flex flex-col w-full min-h-screen ${account && view !== 'welcome' ? 'lg:pl-72' : ''}`}>
        {view === 'welcome' && renderWelcome()}
        {view === 'predict' && renderPredict()}
        {view === 'results' && renderResults()}
        {view === 'admin' && renderAdmin()}

        {/* Footer */}
        <footer className="bg-carbon-black/50 backdrop-blur-md border-t border-white/5 w-full py-10 z-20 relative mt-auto">
          <div className="flex flex-col md:flex-row justify-between items-center px-margin-desktop gap-8 w-full max-w-[1800px] mx-auto">
            <div className="font-label-md text-xs text-on-surface-variant uppercase tracking-[0.2em]">
              © 2026 F1 PODIUM PREDICTOR. PROTOCOL SECURED BY ETHEREUM SEPOLIA.
            </div>
            <div className="flex gap-10">
              {['Whitepaper', 'Twitter', 'Discord'].map((social) => (
                <a key={social} href="#" className="font-label-md text-xs text-on-surface-variant hover:text-status-error transition-colors duration-300 uppercase tracking-widest">{social}</a>
              ))}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
