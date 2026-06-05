import React, { createContext, useState, useEffect, useContext } from 'react';
import { ethers, BrowserProvider, Contract } from 'ethers';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../constants/contract';

/**
 * 온체인 경기 정보 인터페이스
 */
interface RaceInfo {
  raceId: number;
  state: number; // 0: IDLE, 1: ACTIVE, 2: PAUSED, 3: ENDED
  pool: string;
  winnersTotalScore: number;
  deadline: number;
  actualResults: number[];
}

/**
 * 사용자 베팅 정보 인터페이스
 */
interface UserBet {
  raceId: number; // 어떤 경기의 베팅인지 명시
  predictedIds: number[];
  score: number;
  hasClaimed: boolean;
  exists: boolean;
}

/**
 * Web3 컨텍스트 타입 정의
 */
interface Web3ContextType {
  account: string | null;
  provider: BrowserProvider | null;
  contract: Contract | null;
  raceInfo: RaceInfo | null;
  userBet: UserBet | null;
  owner: string | null; // 소유자 주소 추가
  actualResults: number[] | null;
  totalPool: string;
  loading: boolean;
  isAdmin: boolean;
  isCorrectNetwork: boolean;
  connectWallet: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  placeBet: (predictedIds: number[]) => Promise<string>;
  startRace: (round: number, deadline: number) => Promise<void>;
  pauseBetting: () => Promise<void>;
  resolveRace: (results: number[], totalWinnerScores: number) => Promise<void>;
  claimReward: (raceId: number) => Promise<void>;
  recoverPool: (raceId: number) => Promise<void>;
  refreshAll: () => Promise<void>;
}

const Web3Context = createContext<Web3ContextType | null>(null);

declare global {
  interface Window {
    ethereum?: any;
  }
}

const SEPOLIA_CHAIN_ID = "0xaa36a7"; // Sepolia 테스트넷 ID

/**
 * Web3 상태 관리를 위한 Provider 컴포넌트
 */
export const Web3Provider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [raceInfo, setRaceInfo] = useState<RaceInfo | null>(null);
  const [userBet, setUserBet] = useState<UserBet | null>(null);
  const [owner, setOwner] = useState<string | null>(null); // 소유자 상태 추가
  const [isAdmin, setIsAdmin] = useState(false);
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(true);
  const [loading, setLoading] = useState(true);

  // 네트워크 확인 및 전환 함수
  const checkNetwork = async () => {
    if (window.ethereum) {
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      setIsCorrectNetwork(chainId === SEPOLIA_CHAIN_ID);
    }
  };

  const switchNetwork = async () => {
    if (window.ethereum) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: SEPOLIA_CHAIN_ID }],
        });
      } catch (err: any) {
        if (err.code === 4902) alert("MetaMask에 Sepolia 네트워크를 추가해주세요.");
      }
    }
  };

  // 지갑 연결 함수
  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        const _provider = new BrowserProvider(window.ethereum);
        const accounts = await _provider.send("eth_requestAccounts", []);
        setAccount(accounts[0]);
        setProvider(_provider);
        await checkNetwork();
      } catch (err) {
        console.error("지갑 연결 실패:", err);
      }
    } else {
      alert("MetaMask를 설치해주세요.");
    }
  };

  // 온체인 경기 정보 동기화
  const refreshRaceInfo = async () => {
    if (contract) {
      try {
        const info = await contract.getRaceInfo();
        console.log("On-chain Race Info:", {
            raceId: info.raceId.toString(),
            state: Number(info.state),
            pool: ethers.formatEther(info.pool),
            winnersTotalScore: info.winnersTotalScore.toString(),
            deadline: Number(info.dl),
            results: info.results.map((id: any) => Number(id))
        });
        setRaceInfo({
          raceId: Number(info.raceId),
          state: Number(info.state),
          pool: ethers.formatEther(info.pool),
          winnersTotalScore: Number(info.winnersTotalScore),
          deadline: Number(info.dl),
          actualResults: info.results.map((id: any) => Number(id))
        });
      } catch (err) {
        console.error("경기 정보 로드 실패:", err);
      }
    }
  };

  // 사용자 베팅 정보 동기화
  const refreshUserBet = async () => {
    if (contract && account && raceInfo) {
      try {
        console.log(`Web3Context: Refreshing user bet for race ${raceInfo.raceId}`);
        const b = await contract.getUserBet(raceInfo.raceId, account);
        setUserBet({
          raceId: raceInfo.raceId,
          predictedIds: b.predictedIds.map((id: any) => Number(id)),
          score: Number(b.score),
          hasClaimed: b.hasClaimed,
          exists: b.exists
        });
      } catch (err) {
        console.error("사용자 베팅 정보 로드 실패:", err);
      }
    }
  };

  const refreshAll = async () => {
      await refreshRaceInfo();
      // raceInfo가 업데이트된 후 userBet을 가져오도록 보장하기 위해 별도 처리
      if (contract && account) {
        try {
            const info = await contract.getRaceInfo();
            const b = await contract.getUserBet(Number(info.raceId), account);
            setUserBet({
              raceId: Number(info.raceId),
              predictedIds: b.predictedIds.map((id: any) => Number(id)),
              score: Number(b.score),
              hasClaimed: b.hasClaimed,
              exists: b.exists
            });
        } catch (e) {
            console.error("refreshAll userBet load fail:", e);
        }
      }
  };

  // --- 컨트랙트 실행 함수들 ---

  const placeBet = async (predictedIds: number[]): Promise<string> => {
    if (!contract || !account) throw new Error('지갑이 연결되지 않았습니다.');
    if (!isCorrectNetwork) {
      await switchNetwork();
      throw new Error('Sepolia 네트워크로 전환한 뒤 다시 시도해주세요.');
    }
    const signer = await provider!.getSigner();
    const tx = await (contract as any).connect(signer).placeBet(predictedIds, { value: ethers.parseEther("0.01") });
    const receipt = await tx.wait();
    await refreshAll();
    return receipt?.hash ?? tx.hash;
  };

  const startRace = async (round: number, deadline: number) => {
    console.log("Web3Context: startRace called", { round, deadline, contract: !!contract, isAdmin });
    if (!contract) {
        console.error("Web3Context: Contract not initialized");
        return;
    }
    if (!isAdmin) {
        console.error("Web3Context: User is not admin. Current account:", account, "Contract owner:", owner);
        alert("관리자 권한이 없습니다. 컨트랙트 소유자 계정으로 전환해주세요.");
        return;
    }
    try {
        const signer = await provider!.getSigner();
        const tx = await (contract as any).connect(signer).startRace(round, deadline);
        console.log("Web3Context: Transaction sent", tx.hash);
        await tx.wait();
        // [중요] 새로운 경기가 시작되었으므로 기존 베팅 정보를 즉시 초기화
        setUserBet(null);
        await refreshRaceInfo();
        console.log("Web3Context: Transaction confirmed and state cleared");
    } catch (err: any) {
        console.error("Web3Context: startRace error", err);
        throw err;
    }
  };

  const pauseBetting = async () => {
    console.log("Web3Context: pauseBetting called", { contract: !!contract, isAdmin });
    if (!contract || !isAdmin) {
        console.error("Web3Context: Cannot pause betting. Admin:", isAdmin, "Contract:", !!contract);
        return;
    }
    const signer = await provider!.getSigner();
    const tx = await (contract as any).connect(signer).pauseBetting();
    await tx.wait();
    await refreshRaceInfo();
  };

  const resolveRace = async (results: number[], totalWinnerScores: number) => {
    console.log("Web3Context: resolveRace called", { results, totalWinnerScores, contract: !!contract, isAdmin });
    if (!contract || !isAdmin) {
        console.error("Web3Context: Cannot resolve race. Admin:", isAdmin, "Contract:", !!contract);
        return;
    }
    const signer = await provider!.getSigner();
    const tx = await (contract as any).connect(signer).resolveRace(results, totalWinnerScores);
    await tx.wait();
    await refreshAll();
  };

  const claimReward = async (raceId: number) => {
    if (!contract || !account) throw new Error('지갑이 연결되지 않았습니다.');
    if (!isCorrectNetwork) {
      await switchNetwork();
      throw new Error('Sepolia 네트워크로 전환한 뒤 다시 시도해주세요.');
    }
    const signer = await provider!.getSigner();
    try {
      const tx = await (contract as any).connect(signer).claimReward(raceId);
      await tx.wait();
      await refreshAll();
    } catch (err: any) {
      const reason = err?.reason || err?.shortMessage || err?.message || '보상 수령에 실패했습니다.';
      throw new Error(reason);
    }
  };

  const recoverPool = async (raceId: number) => {
    if (!contract || !isAdmin) return;
    const signer = await provider!.getSigner();
    const tx = await (contract as any).connect(signer).recoverPool(raceId);
    await tx.wait();
    await refreshRaceInfo();
  };

  // 초기화 및 리스너 설정
  useEffect(() => {
    const init = async () => {
      if (window.ethereum) {
        const _provider = new BrowserProvider(window.ethereum);
        const accounts = await _provider.send("eth_accounts", []);
        if (accounts.length > 0) setAccount(accounts[0]);
        setProvider(_provider);
        await checkNetwork();
      }
      setLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    if (provider) setContract(new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider));
  }, [provider]);

  useEffect(() => {
    if (contract) {
      refreshRaceInfo();
      const checkAdminAndOwner = async () => {
        try {
          const contractOwner = await contract.owner();
          setOwner(contractOwner);
          setIsAdmin(contractOwner.toLowerCase() === account?.toLowerCase());
        } catch (err) { console.error("관리자/소유자 확인 실패:", err); }
      };
      checkAdminAndOwner();
    }
  }, [contract, account]);

  useEffect(() => {
    if (contract && account && raceInfo) refreshUserBet();
    else setUserBet(null);
  }, [contract, account, raceInfo?.raceId]);

  return (
    <Web3Context.Provider value={{ 
      account, provider, contract, raceInfo, userBet, owner,
      actualResults: raceInfo?.actualResults || null,
      totalPool: raceInfo?.pool || "0.00",
      loading, isAdmin, isCorrectNetwork,
      connectWallet, switchNetwork, placeBet, startRace, pauseBetting, resolveRace, claimReward, recoverPool, refreshAll
    }}>
      {children}
    </Web3Context.Provider>
  );
};

export const useWeb3 = () => {
  const context = useContext(Web3Context);
  if (!context) throw new Error("useWeb3 must be used within Web3Provider");
  return context;
};
