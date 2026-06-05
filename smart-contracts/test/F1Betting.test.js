import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("F1Betting", function () {
  let f1Betting;
  let owner;
  let addr1;
  let addr2;
  let addr3;
  const entranceFee = ethers.parseEther("0.01");

  beforeEach(async function () {
    [owner, addr1, addr2, addr3] = await ethers.getSigners();
    const F1Betting = await ethers.getContractFactory("F1Betting");
    f1Betting = await F1Betting.deploy();
  });

  describe("초기 상태 (Initial State)", function () {
    it("올바른 오너가 설정되어야 합니다.", async function () {
      expect(await f1Betting.owner()).to.equal(owner.address);
    });

    it("raceId 0과 IDLE 상태로 시작해야 합니다.", async function () {
      const info = await f1Betting.getRaceInfo();
      expect(info.raceId).to.equal(0n);
      expect(info.state).to.equal(0n); // RaceState.IDLE
    });
  });

  describe("경기 관리 (Race Management)", function () {
    it("오너는 경기를 시작할 수 있어야 합니다.", async function () {
      const deadline = (await time.latest()) + 3600;
      await expect(f1Betting.startRace(1, deadline))
        .to.emit(f1Betting, "RaceStarted")
        .withArgs(1n, BigInt(deadline));
      
      const info = await f1Betting.getRaceInfo();
      expect(info.raceId).to.equal(1n);
      expect(info.state).to.equal(1n); // RaceState.ACTIVE
    });

    it("오너는 베팅을 중단(PAUSE)할 수 있어야 합니다.", async function () {
        const deadline = (await time.latest()) + 3600;
        await f1Betting.startRace(1, deadline);
        await f1Betting.pauseBetting();
        const info = await f1Betting.getRaceInfo();
        expect(info.state).to.equal(2n); // RaceState.PAUSED
    });
  });

  describe("베팅 (Betting)", function () {
    beforeEach(async function () {
      const deadline = (await time.latest()) + 3600;
      await f1Betting.startRace(1, deadline);
    });

    it("사용자는 베팅을 할 수 있어야 합니다.", async function () {
      await expect(f1Betting.connect(addr1).placeBet([1, 2, 3], { value: entranceFee }))
        .to.emit(f1Betting, "BetPlaced")
        .withArgs(1n, addr1.address, [1, 2, 3]);

      const bet = await f1Betting.getUserBet(1, addr1.address);
      expect(bet.exists).to.be.true;
    });

    it("중복된 드라이버 ID는 실패해야 합니다.", async function () {
        await expect(f1Betting.connect(addr1).placeBet([1, 1, 2], { value: entranceFee }))
          .to.be.revertedWith("중복된 드라이버 ID를 선택할 수 없습니다.");
    });
  });

  describe("결과 확정 및 보상 (Resolution and Rewards)", function () {
    beforeEach(async function () {
      const deadline = (await time.latest()) + 3600;
      await f1Betting.startRace(1, deadline);

      // 사용자 1: 1위 적중 (5점)
      await f1Betting.connect(addr1).placeBet([1, 2, 3], { value: entranceFee });
      // 사용자 2: 2위 적중 (3점)
      await f1Betting.connect(addr2).placeBet([4, 2, 6], { value: entranceFee });
    });

    it("점수를 올바르게 계산하고 보상을 분배해야 합니다.", async function () {
      // 결과: 1, 5, 6 (1위는 addr1이 맞춤, 2위는 아무도 못맞춤, 3위는 아무도 못맞춤)
      // addr1: [1,2,3] vs [1,5,6] => 1위 맞춤 = 5점
      // addr2: [4,2,6] vs [1,5,6] => 0점
      
      const totalWinnerScores = 5; // 오프체인 계산 결과
      await f1Betting.resolveRace([1, 5, 6], totalWinnerScores);

      const info = await f1Betting.getRaceInfo();
      expect(info.state).to.equal(3n); // RaceState.ENDED

      // addr1 보상 수령
      const initialBalance = await ethers.provider.getBalance(addr1.address);
      await f1Betting.connect(addr1).claimReward(1);
      const finalBalance = await ethers.provider.getBalance(addr1.address);
      
      expect(finalBalance).to.be.gt(initialBalance);
    });

    it("적중자가 없을 경우 오너가 회수할 수 있어야 합니다.", async function () {
        await f1Betting.resolveRace([10, 11, 12], 0); // 아무도 못맞춤
        
        const initialOwnerBalance = await ethers.provider.getBalance(owner.address);
        await f1Betting.recoverPool(1);
        const finalOwnerBalance = await ethers.provider.getBalance(owner.address);
        
        expect(finalOwnerBalance).to.be.gt(initialOwnerBalance);
    });
  });
});
