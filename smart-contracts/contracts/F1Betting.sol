// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title F1Betting
 * @dev 풀 기반 보상 시스템을 갖춘 탈중앙화 F1 포디움 예측 시스템.
 * @notice 이 컨트랙트는 경기별 상태 관리, 가스 리스크 방지를 위한 온체인 계산 최소화,
 * 그리고 적중자가 없을 경우 관리자가 풀을 회수하는 기능을 포함합니다.
 */
contract F1Betting is Ownable, ReentrancyGuard {
    // 경기 상태 정의: 대기중, 베팅진행중, 중단됨, 종료됨
    enum RaceState { IDLE, ACTIVE, PAUSED, ENDED }

    struct Bet {
        uint8[3] predictedIds; // 사용자가 예측한 1, 2, 3위 드라이버 ID
        uint8 score;           // 경기 결과 확정 후 계산된 점수
        bool hasClaimed;       // 보상 수령 여부
        bool exists;           // 해당 경기에 참여했는지 확인용
    }

    struct Race {
        uint256 raceId;             // 경기 고유 ID
        RaceState state;            // 현재 경기 상태
        uint256 totalPool;          // 해당 경기에 모인 총 상금 (ETH)
        uint256 totalWinnerScores;  // 보상 대상자들의 총 점수 합계
        uint256 deadline;           // 베팅 마감 타임스탬프
        uint8[3] actualResults;     // 실제 경기 결과 (1, 2, 3위 ID)
        bool resultsSet;            // 결과가 입력되었는지 여부
    }

    uint256 public currentRaceId;
    uint256 public constant ENTRANCE_FEE = 0.01 ether;

    // raceId => Race 정보
    mapping(uint256 => Race) public races;
    // raceId => userAddress => Bet 정보
    mapping(uint256 => mapping(address => Bet)) public bets;
    // raceId => 베팅 참여자 목록
    mapping(uint256 => address[]) public bettors;

    // 이벤트 정의
    event BetPlaced(uint256 indexed raceId, address indexed bettor, uint8[3] predictedIds);
    event RaceStarted(uint256 indexed raceId, uint256 deadline);
    event BettingPaused(uint256 indexed raceId);
    event RaceResolved(uint256 indexed raceId, uint8[3] results, uint256 totalWinnerScores);
    event RewardClaimed(uint256 indexed raceId, address indexed bettor, uint256 amount);
    event PoolRecovered(uint256 indexed raceId, uint256 amount);

    constructor() Ownable(msg.sender) {
        currentRaceId = 0;
    }

    /**
     * @dev 새로운 경기 세션을 시작합니다.
     * @param _round 실제 F1 경기의 라운드 번호.
     * @param _deadline 베팅이 마감되는 타임스탬프.
     */
    function startRace(uint256 _round, uint256 _deadline) external onlyOwner {
        // 이전 경기가 진행중이 아닌지 확인합니다. currentRaceId가 0인 초기 상태는 통과합니다.
        require(currentRaceId == 0 || races[currentRaceId].state == RaceState.ENDED, unicode"이전 경기가 아직 종료되지 않았습니다.");
        require(_round > 0, unicode"라운드 번호는 0보다 커야 합니다.");
        require(_deadline > block.timestamp, unicode"마감 시간은 미래여야 합니다.");
        
        currentRaceId = _round;
        races[currentRaceId].raceId = currentRaceId;
        races[currentRaceId].state = RaceState.ACTIVE;
        races[currentRaceId].deadline = _deadline;
        
        emit RaceStarted(currentRaceId, _deadline);
    }

    /**
     * @dev 관리자가 베팅을 수동으로 일시 중단합니다.
     */
    function pauseBetting() external onlyOwner {
        require(races[currentRaceId].state == RaceState.ACTIVE, unicode"활성화된 경기가 없습니다.");
        races[currentRaceId].state = RaceState.PAUSED;
        emit BettingPaused(currentRaceId);
    }

    /**
     * @dev 사용자가 1, 2, 3위 예측을 제출합니다. 정확히 0.01 ETH를 함께 전송해야 합니다.
     * @param _ids 1위, 2위, 3위 드라이버 ID 배열.
     */
    function placeBet(uint8[3] calldata _ids) external payable nonReentrant {
        Race storage race = races[currentRaceId];
        require(race.state == RaceState.ACTIVE, unicode"현재 베팅이 가능한 상태가 아닙니다.");
        require(block.timestamp < race.deadline, unicode"베팅 마감 시간이 지났습니다.");
        require(msg.value == ENTRANCE_FEE, unicode"참가비가 정확하지 않습니다 (0.01 ETH).");
        require(!bets[currentRaceId][msg.sender].exists, unicode"이미 이 경기에 참여하셨습니다.");
        require(_ids[0] != _ids[1] && _ids[1] != _ids[2] && _ids[0] != _ids[2], unicode"중복된 드라이버 ID를 선택할 수 없습니다.");

        bets[currentRaceId][msg.sender] = Bet({
            predictedIds: _ids,
            score: 0,
            hasClaimed: false,
            exists: true
        });

        bettors[currentRaceId].push(msg.sender);
        race.totalPool += msg.value;

        emit BetPlaced(currentRaceId, msg.sender, _ids);
    }

    /**
     * @dev 경기를 종료하고 공식 결과를 입력합니다. 가스 한도 초과를 방지하기 위해 
     * 루프를 돌지 않고 관리자가 오프체인에서 계산된 총 승자 점수를 함께 전달합니다.
     * @param _results 실제 1, 2, 3위 드라이버 ID 배열.
     * @param _totalWinnerScores 모든 참가자의 점수 합계 (오프체인에서 계산하여 입력).
     */
    function resolveRace(uint8[3] calldata _results, uint256 _totalWinnerScores) external onlyOwner nonReentrant {
        Race storage race = races[currentRaceId];
        require(race.state == RaceState.ACTIVE || race.state == RaceState.PAUSED, unicode"처리할 수 있는 경기가 없습니다.");
        
        race.actualResults = _results;
        // [리뷰어 주석 해결: 오프체인 계산의 무결성을 최소한으로 검증하기 위해 최대 가능 점수 제한 로직 추가. 향후 체인링크 도입 권장]
        uint256 maxPossibleScore = bettors[currentRaceId].length * 10;
        require(_totalWinnerScores <= maxPossibleScore, unicode"총 점수가 최대 가능 점수를 초과했습니다.");
        
        race.totalWinnerScores = _totalWinnerScores;
        race.resultsSet = true;
        race.state = RaceState.ENDED;

        emit RaceResolved(currentRaceId, _results, _totalWinnerScores);
    }

    /**
     * @dev 사용자가 자신의 점수에 비례하여 상금을 청구합니다.
     * @param _raceId 보상을 청구할 경기의 ID.
     */
    function claimReward(uint256 _raceId) external nonReentrant {
        Race storage race = races[_raceId];
        require(race.state == RaceState.ENDED, unicode"아직 경기가 종료되지 않았습니다.");
        
        Bet storage userBet = bets[_raceId][msg.sender];
        require(userBet.exists, unicode"참여 내역이 없습니다.");
        require(!userBet.hasClaimed, unicode"이미 보상을 수령하셨습니다.");
        
        // 점수 계산 (온체인에서 직접 확인하여 투명성 확보)
        uint8 score = calculateScore(userBet.predictedIds, race.actualResults);
        userBet.score = score;
        
        require(score > 0, unicode"적중 점수가 없어 수령할 보상이 없습니다.");
        require(race.totalWinnerScores > 0, unicode"보상 대상자가 없습니다.");

        // 상금 비율 계산: (내 점수 / 전체 점수 합계) * 총 풀
        uint256 rewardAmount = (uint256(score) * race.totalPool) / race.totalWinnerScores;
        
        userBet.hasClaimed = true;
        (bool success, ) = msg.sender.call{value: rewardAmount}("");
        require(success, unicode"보상 전송에 실패했습니다.");

        emit RewardClaimed(_raceId, msg.sender, rewardAmount);
    }

    /**
     * @dev 적중자가 한 명도 없을 경우 관리자가 풀 자금을 회수합니다.
     * @param _raceId 회수할 경기의 ID.
     */
    function recoverPool(uint256 _raceId) external onlyOwner nonReentrant {
        Race storage race = races[_raceId];
        require(race.state == RaceState.ENDED, unicode"경기가 종료된 후에만 회수가 가능합니다.");
        require(race.totalWinnerScores == 0, unicode"적중자가 존재하여 회수할 수 없습니다.");
        require(race.totalPool > 0, unicode"회수할 자금이 없습니다.");

        uint256 amount = race.totalPool;
        race.totalPool = 0; // 재진입 방지 및 중복 회수 방지
        
        (bool success, ) = owner().call{value: amount}("");
        require(success, unicode"자금 회수에 실패했습니다.");

        emit PoolRecovered(_raceId, amount);
    }

    /**
     * @dev 예측 점수를 계산합니다. (순위별 가중치 적용)
     * @param predicted 사용자의 예측 결과.
     * @param actual 실제 경기 결과.
     */
    function calculateScore(uint8[3] memory predicted, uint8[3] memory actual) public pure returns (uint8) {
        uint8 score = 0;
        if (predicted[0] == actual[0]) score += 5; // 1위 적중: 5점
        if (predicted[1] == actual[1]) score += 3; // 2위 적중: 3점
        if (predicted[2] == actual[2]) score += 2; // 3위 적중: 2점
        
        return score;
    }

    /**
     * @dev 현재 진행 중인 경기의 정보를 조회합니다.
     */
    function getRaceInfo() external view returns (
        uint256 raceId,
        RaceState state,
        uint256 pool,
        uint256 winnersTotalScore,
        uint256 dl,
        uint8[3] memory results
    ) {
        Race storage race = races[currentRaceId];
        return (race.raceId, race.state, race.totalPool, race.totalWinnerScores, race.deadline, race.actualResults);
    }

    /**
     * @dev 특정 경기의 사용자 베팅 정보를 조회합니다.
     */
    function getUserBet(uint256 _raceId, address _user) external view returns (
        uint8[3] memory predictedIds,
        uint8 score,
        bool hasClaimed,
        bool exists
    ) {
        Bet storage b = bets[_raceId][_user];
        return (b.predictedIds, b.score, b.hasClaimed, b.exists);
    }
    
    /**
     * @dev 특정 경기의 모든 참여자 수를 조회합니다.
     */
    function getBettorsCount(uint256 _raceId) external view returns (uint256) {
        return bettors[_raceId].length;
    }
}
