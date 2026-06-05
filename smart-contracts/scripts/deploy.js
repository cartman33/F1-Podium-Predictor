import pkg from "hardhat";
const { ethers } = pkg;

async function main() {
  console.log("Starting deployment of F1Betting...");

  const F1Betting = await ethers.getContractFactory("F1Betting");
  const f1Betting = await F1Betting.deploy();

  await f1Betting.waitForDeployment();

  const address = await f1Betting.getAddress();
  console.log(`F1Betting deployed to: ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
