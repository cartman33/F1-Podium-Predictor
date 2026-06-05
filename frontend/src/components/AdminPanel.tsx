import { useState, useEffect } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { getRaceSchedule, calculateTotalWinnerScores, resetDatabase, forceSync } from '../services/api';
import type { DriverStats } from '../services/api';

/**
 * 관리자 전용 제어 패널 컴포넌트입니다. (최종 수정 버전)
 */
interface AdminPanelProps {
  drivers: DriverStats[];
}

const AdminPanel: React.FC<AdminPanelProps> = ({ drivers }) => {
  const { startRace, pauseBetting, resolveRace, recoverPool, raceInfo, totalPool, refreshAll } = useWeb3();
  const [p1, setP1] = useState<string>('');
  const [p2, setP2] = useState<string>('');
  const [p3, setP3] = useState<string>('');
  const [schedule, setSchedule] = useState<any[]>([]);
  const [selectedRace, setSelectedRace] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [simulatedScore, setSimulatedScore] = useState<number | null>(null);
  const version = "4.1.0-PRO";

  // 시즌 일정 로드 및 자동 선택
  useEffect(() => {
    const fetchSchedule = async () => {
      try {
        const data = await getRaceSchedule();
        setSchedule(data);
        // 아직 시작되지 않은 다음 경기를 기본값으로 자동 선택
        const next = data.find((r: any) => r.status === 'PENDING');
        if (next) setSelectedRace(next.round.toString());
      } catch (err) {
        console.error("일정 로드 실패:", err);
      }
    };
    fetchSchedule();
  }, []);

  // 결과 입력 시 실시간 점수 시뮬레이션
  useEffect(() => {
    if (p1 && p2 && p3 && raceInfo && (raceInfo.state === 1 || raceInfo.state === 2)) {
        const timer = setTimeout(async () => {
            try {
                const score = await calculateTotalWinnerScores(raceInfo.raceId, p1, p2, p3);
                setSimulatedScore(score);
            } catch (e) {
                console.warn("Score simulation failed", e);
                setSimulatedScore(null);
            }
        }, 500);
        return () => clearTimeout(timer);
    } else {
        setSimulatedScore(null);
    }
  }, [p1, p2, p3, raceInfo?.raceId, raceInfo?.state]);

  /**
   * 새로운 경기 세션을 온체인에 등록합니다.
   */
  const handleStartRace = async () => {
    if (!selectedRace) {
      alert("경기를 선택해주세요.");
      return;
    }
    
    const race = schedule.find(r => r.round.toString() === selectedRace);
    if (!race) return;

    const timeStr = race.time ? race.time.replace('Z', '') : '00:00:00';
    // UTC 기준으로 정확한 마감 시간을 계산
    const raceDateTime = new Date(`${race.date}T${timeStr}Z`);
    let deadlineTimestamp = Math.floor(raceDateTime.getTime() / 1000) - 3600;

    const nowTimestamp = Math.floor(Date.now() / 1000);
    
    if (deadlineTimestamp <= nowTimestamp) {
        if (confirm("해당 경기의 공식 마감 시간이 지났습니다. 테스트를 위해 지금부터 1시간 동안 베팅을 허용하시겠습니까?")) {
            deadlineTimestamp = nowTimestamp + 3600;
        } else {
            return;
        }
    }

    setIsProcessing(true);
    try {
      await startRace(Number(selectedRace), deadlineTimestamp);
      alert(`${race.raceName} 세션이 성공적으로 시작되었습니다.`);
      // 온체인 성공 후 즉시 백엔드 동기화
      await forceSync();
      await refreshAll();
    } catch (err: any) {
      console.error(err);
      alert("세션 시작 실패: " + (err.reason || err.message));
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * 베팅을 즉시 조기 종료합니다.
   */
  const handleEarlyTerminate = async () => {
    if (!confirm("마감 시간이 남았더라도 지금 즉시 베팅을 종료하시겠습니까?")) return;
    
    setIsProcessing(true);
    try {
      await pauseBetting();
      alert("베팅이 조기 종료되었습니다. 이제 결과를 확정할 수 있습니다.");
      await forceSync();
      await refreshAll();
    } catch (err: any) {
      console.error(err);
      alert("조기 종료 실패: " + (err.reason || err.message));
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * 경기 결과를 확정하고 상금을 정산합니다.
   */
  const handleResolve = async () => {
    if (!p1 || !p2 || !p3 || !raceInfo) {
      alert("모든 순위(1, 2, 3위) 정보를 입력해주세요.");
      return;
    }
    
    setIsProcessing(true);
    try {
      console.log("Admin: Resolving race", raceInfo.raceId, { p1, p2, p3 });
      let totalScore = 0;
      try {
        totalScore = await calculateTotalWinnerScores(raceInfo.raceId, p1, p2, p3);
      } catch (scoreErr: any) {
        console.error("Score calculation API failed:", scoreErr.response?.data || scoreErr.message);
        if (!confirm("백엔드 점수 계산 API가 실패했습니다. (원인: " + (scoreErr.response?.data?.error || "서버 오류") + ")\n\n이 오류를 무시하고 0점으로 강제 정산을 진행하시겠습니까? (적중자가 없는 경우에만 권장)")) {
            setIsProcessing(false);
            return;
        }
      }

      if (totalScore === 0) {
        if (!confirm("계산된 총 승자 점수가 0점입니다. 적중자가 없는 것이 확실합니까? (확인을 누르면 관리자가 풀을 회수할 수 있는 상태로 종료됩니다)")) {
            setIsProcessing(false);
            return;
        }
      }
      
      await resolveRace([parseInt(p1, 10), parseInt(p2, 10), parseInt(p3, 10)], totalScore);
      alert("경기 결과가 확정되었습니다. 사용자들이 보상을 수령할 수 있습니다.");
      await forceSync();
      await refreshAll();
    } catch (err: any) {
      console.error("resolveRace failed:", err);
      alert("결과 확정 실패: " + (err.reason || err.message));
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * DB를 강제 초기화합니다.
   */
  const handleResetSystem = async () => {
    if (!confirm("데이터베이스의 모든 베팅 내역을 삭제하고 경기를 초기 상태로 돌리시겠습니까?")) return;
    setIsProcessing(true);
    try {
      await resetDatabase();
      alert("데이터베이스가 초기화되었습니다.");
      window.location.reload();
    } catch (err) {
      alert("초기화 실패");
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * 온체인 상태와 DB를 강제 동기화합니다.
   */
  const handleForceSync = async () => {
    setIsProcessing(true);
    try {
      await forceSync();
      alert("동기화 요청 완료.");
      await refreshAll();
    } catch (err) {
      alert("동기화 실패");
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * 적중자가 없을 경우 관리자가 풀을 회수합니다.
   */
  const handleRecover = async () => {
    if (!raceInfo) return;
    if (!confirm("적중자가 없어 풀에 남은 모든 ETH를 회수하시겠습니까?")) return;

    setIsProcessing(true);
    try {
      await recoverPool(raceInfo.raceId);
      alert("풀 자금이 성공적으로 회수되었습니다.");
      await refreshAll();
    } catch (err: any) {
      console.error(err);
      alert("자금 회수 실패: " + (err.reason || err.message));
    } finally {
      setIsProcessing(false);
    }
  };

  const isIdleOrEnded = !raceInfo || Number(raceInfo.raceId) === 0 || raceInfo.state === 0 || raceInfo.state === 3;
  const isActive = raceInfo?.state === 1;
  const isPaused = raceInfo?.state === 2;

  return (
    <div className="flex flex-col gap-10">
      <div className="mb-10 flex flex-col md:flex-row justify-between items-start md:items-center border-b border-white/10 pb-8 gap-6">
        <div>
          <h1 className="font-display-lg text-6xl md:text-7xl font-black text-f1-white uppercase tracking-tighter flex items-center gap-4">
            레이스 컨트롤
            <span className="text-xs bg-white/10 text-white/40 px-2 py-1 rounded font-mono">{version}</span>
          </h1>
          <div className="inline-flex items-center gap-3 px-4 py-2 rounded-lg bg-status-error/10 border border-status-error/20 mt-4">
            <span className="material-symbols-outlined text-status-error text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>gpp_maybe</span>
            <span className="font-label-md text-sm text-status-error uppercase tracking-widest font-bold">관리자 권한 활성화됨</span>
          </div>
        </div>
        <div className="flex gap-4">
          <button onClick={handleForceSync} disabled={isProcessing} className="bg-white/5 hover:bg-white/10 text-f1-white px-6 py-2 rounded-lg border border-white/10 text-sm font-bold flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">sync</span> 온체인 동기화
          </button>
          <button onClick={handleResetSystem} disabled={isProcessing} className="bg-status-error/10 hover:bg-status-error/20 text-status-error px-6 py-2 rounded-lg border border-status-error/20 text-sm font-bold flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">restart_alt</span> DB 초기화
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* 현황판 */}
        <div className="lg:col-span-4 flex flex-col gap-10">
          <div className="glass-panel border border-white/5 rounded-2xl p-8 relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-2 h-full bg-status-live"></div>
            <h3 className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest mb-4">현재 프로토콜 풀</h3>
            <div className="font-stats-number text-5xl font-extrabold text-f1-white">{totalPool} <span className="text-2xl text-status-live italic">ETH</span></div>
          </div>
          
          <div className="glass-panel border border-status-error/30 rounded-2xl p-8 relative overflow-hidden group shadow-[0_0_30px_rgba(255,24,1,0.1)]">
            <div className="absolute top-0 left-0 w-2 h-full bg-status-error"></div>
            <h3 className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest mb-4">프로토콜 상태 (Code: {raceInfo?.state ?? '0'})</h3>
            <div className="font-stats-number text-6xl font-black animate-pulse text-status-error tracking-tighter">
              {
                !raceInfo || raceInfo.state === 0 ? '시스템 대기중' : 
                raceInfo.state === 1 ? '베팅 활성화' : 
                raceInfo.state === 2 ? '베팅 중단됨' : '정산 완료'
              }
            </div>
          </div>

          {raceInfo?.state === 3 && raceInfo.winnersTotalScore === 0 && Number(totalPool) > 0 && (
             <div className="glass-panel border border-primary rounded-2xl p-8 bg-primary/5 animate-in fade-in zoom-in">
                <h3 className="font-headline-md text-xl text-primary mb-4 flex items-center gap-2">
                    <span className="material-symbols-outlined">info</span> 적중자 없음
                </h3>
                <p className="text-on-surface-variant mb-6 text-sm">해당 경기에 예측을 성공한 사용자가 없습니다. 풀에 쌓인 {totalPool} ETH를 관리자 지갑으로 회수할 수 있습니다.</p>
                <button 
                  onClick={handleRecover}
                  className="w-full bg-primary text-carbon-black font-bold py-3 rounded-xl hover:opacity-90 transition-all shadow-lg"
                >
                  자금 회수 실행
                </button>
             </div>
          )}
        </div>

        {/* 경기 제어 */}
        <div className="lg:col-span-8 flex flex-col gap-10">
          {/* 결과 확정 카드 */}
          <div className={`glass-panel border border-white/5 rounded-2xl p-10 relative overflow-hidden ${isActive || isPaused ? 'glow-active' : 'opacity-40 grayscale'}`}>
            <div className="absolute top-0 left-0 w-full h-1.5 bg-status-error"></div>
            <h2 className="font-headline-md text-3xl text-f1-white uppercase border-b border-white/5 pb-6 mb-10 flex items-center justify-between font-bold">
              경기 결과 확정 (Resolve)
              {simulatedScore !== null && (
                <span className="bg-primary/20 text-primary px-4 py-1.5 rounded-full font-label-md text-xs border border-primary/30 animate-pulse">
                    시뮬레이션 점수: {simulatedScore} PTS
                </span>
              )}
              <span className="bg-status-error/20 text-status-error px-4 py-1.5 rounded-full font-label-md text-xs border border-status-error/30 tracking-widest">결과 입력 대기</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
              <div className="flex flex-col gap-3">
                <label className="font-label-md text-xs text-status-pending uppercase tracking-widest px-1 font-bold">1위 (P1)</label>
                <select value={p1} onChange={e => setP1(e.target.value)} disabled={!isActive && !isPaused} className="bg-black/60 border border-white/10 rounded-xl px-4 py-4 text-lg font-bold text-f1-white outline-none focus:border-status-error transition-all appearance-none cursor-pointer">
                  <option value="">드라이버 선택</option>
                  {drivers.map(d => <option key={d.driverId} value={d.permanentNumber}>#{d.permanentNumber} {d.familyName}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-3">
                <label className="font-label-md text-xs text-on-surface-variant uppercase tracking-widest px-1 font-bold">2위 (P2)</label>
                <select value={p2} onChange={e => setP2(e.target.value)} disabled={!isActive && !isPaused} className="bg-black/60 border border-white/10 rounded-xl px-4 py-4 text-lg font-bold text-f1-white outline-none focus:border-status-error transition-all appearance-none cursor-pointer">
                  <option value="">드라이버 선택</option>
                  {drivers.map(d => <option key={d.driverId} value={d.permanentNumber}>#{d.permanentNumber} {d.familyName}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-3">
                <label className="font-label-md text-xs text-on-surface-variant uppercase tracking-widest px-1 font-bold">3위 (P3)</label>
                <select value={p3} onChange={e => setP3(e.target.value)} disabled={!isActive && !isPaused} className="bg-black/60 border border-white/10 rounded-xl px-4 py-4 text-lg font-bold text-f1-white outline-none focus:border-status-error transition-all appearance-none cursor-pointer">
                  <option value="">드라이버 선택</option>
                  {drivers.map(d => <option key={d.driverId} value={d.permanentNumber}>#{d.permanentNumber} {d.familyName}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-between items-center pt-8 border-t border-white/5">
              <button 
                onClick={handleEarlyTerminate}
                disabled={!isActive || isProcessing}
                className="bg-status-error/10 hover:bg-status-error/20 text-status-error px-6 py-3 rounded-xl flex items-center gap-2 font-bold uppercase tracking-widest text-sm transition-all border border-status-error/30 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined">block</span> 베팅 조기 종료
              </button>
              <button 
                onClick={handleResolve}
                disabled={isProcessing || (!isActive && !isPaused)}
                className="bg-status-error text-f1-white font-headline-md text-xl px-12 py-4 rounded-xl uppercase tracking-widest flex items-center gap-3 hover:bg-status-error/90 transition-all hover:scale-105 disabled:opacity-20 disabled:grayscale shadow-lg shadow-status-error/20"
              >
                <span className="material-symbols-outlined text-2xl">gavel</span>
                {isProcessing ? "정산 처리 중..." : "결과 확정 및 상금 정산"}
              </button>
            </div>
          </div>

          {/* 경기 시작 카드 */}
          <div className={`glass-panel border border-white/5 rounded-2xl p-10 ${!isIdleOrEnded ? 'opacity-40 grayscale pointer-events-none' : ''}`}>
            <h2 className="font-headline-md text-3xl text-f1-white uppercase border-b border-white/5 pb-6 mb-10 flex items-center gap-4 font-bold">
              신규 경기 세션 활성화 (Start)
            </h2>
            <div className="flex flex-col gap-3 mb-10">
              <label className="font-label-md text-xs text-on-surface-variant uppercase tracking-widest px-1 font-bold">진행할 그랑프리 선택</label>
              <select value={selectedRace} onChange={e => setSelectedRace(e.target.value)} disabled={!isIdleOrEnded || isProcessing} className="bg-black/60 border border-white/10 rounded-xl px-6 py-4 text-xl font-bold text-f1-white outline-none focus:border-status-error transition-all w-full appearance-none cursor-pointer">
                <option value="" disabled>시즌 일정에서 선택</option>
                {schedule.map(r => <option key={r.round} value={r.round.toString()}>{r.round}라운드: {r.raceName} ({new Date(r.date).toLocaleDateString()})</option>)}
              </select>
            </div>
            <div className="flex justify-end pt-8 border-t border-white/5">
              <button 
                onClick={handleStartRace}
                disabled={isProcessing || !isIdleOrEnded}
                className="bg-white text-carbon-black font-headline-md text-xl px-12 py-4 rounded-xl uppercase tracking-widest flex items-center gap-3 hover:bg-f1-white transition-all hover:scale-105 disabled:opacity-50 shadow-lg"
              >
                <span className="material-symbols-outlined">rocket_launch</span>
                {isProcessing ? "세션 시작 중..." : "베팅 시작"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
