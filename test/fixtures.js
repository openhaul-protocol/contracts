const { ethers, network } = require("hardhat");

async function deployFixture() {
  const [owner, shipper, carrier, juror1, juror2, juror3, juror4, juror5, treasury, team, liquidity, ecosystem, reserve] = await ethers.getSigners();

  // 1. Mock USDT
  const MockUSDT = await ethers.getContractFactory("MockUSDT");
  const usdt = await MockUSDT.deploy();
  await usdt.waitForDeployment();

  // 2. HAUL Token
  const HAULToken = await ethers.getContractFactory("HAULToken");
  const haul = await HAULToken.deploy(team.address, liquidity.address, ecosystem.address, reserve.address);
  await haul.waitForDeployment();

  // 3. ReputationContract
  const ReputationContract = await ethers.getContractFactory("ReputationContract");
  const reputation = await ReputationContract.deploy();
  await reputation.waitForDeployment();

  // 4. OrderContract (with placeholder dispute address)
  const OrderContract = await ethers.getContractFactory("OrderContract");
  const order = await OrderContract.deploy(
    await usdt.getAddress(),
    await reputation.getAddress(),
    ethers.ZeroAddress,
    treasury.address
  );
  await order.waitForDeployment();

  // 5. DisputeContract (needs actual OrderContract address)
  const DisputeContract = await ethers.getContractFactory("DisputeContract");
  const dispute = await DisputeContract.deploy(
    await haul.getAddress(),
    await reputation.getAddress(),
    await order.getAddress()
  );
  await dispute.waitForDeployment();

  // 6. Patch OrderContract's disputeContract (slot 5)
  const orderAddr = await order.getAddress();
  const disputeAddr = await dispute.getAddress();
  const slot = "0x" + BigInt(3).toString(16).padStart(64, "0");
  const value = "0x" + disputeAddr.slice(2).padStart(64, "0");
  await network.provider.send("hardhat_setStorageAt", [orderAddr, slot, value]);

  // 7. Authorize OrderContract and DisputeContract in Reputation
  await reputation.authorizeCaller(orderAddr);
  await reputation.authorizeCaller(disputeAddr);

  // 8. Mint USDT to test accounts
  const mintAmount = ethers.parseUnits("1000000", 6);
  for (const acct of [shipper, carrier, juror1, juror2, juror3, juror4, juror5]) {
    await usdt.mint(acct.address, mintAmount);
  }

  // 9. Mint HAUL to test accounts (for juror staking / dispute fees)
  const haulMint = ethers.parseUnits("100000", 18);
  for (const acct of [shipper, carrier, juror1, juror2, juror3, juror4, juror5]) {
    await haul.connect(liquidity).transfer(acct.address, haulMint);
  }

  // 10. Prepare impersonated signers for contract-to-contract calls
  for (const addr of [orderAddr, disputeAddr]) {
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [addr] });
    await network.provider.send("hardhat_setBalance", [addr, "0x10000000000000000000"]);
  }
  const orderSigner = await ethers.getSigner(orderAddr);
  const disputeSigner = await ethers.getSigner(disputeAddr);

  return {
    owner, shipper, carrier, juror1, juror2, juror3, juror4, juror5, treasury,
    team, liquidity, ecosystem, reserve,
    usdt, haul, reputation, order, dispute,
    orderSigner, disputeSigner
  };
}

module.exports = { deployFixture };
