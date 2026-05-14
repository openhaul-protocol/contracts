const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./fixtures");

describe("HAULToken", function () {
  let haul, team, liquidity, ecosystem, reserve, owner, shipper;

  beforeEach(async function () {
    const f = await deployFixture();
    haul = f.haul;
    team = f.team;
    liquidity = f.liquidity;
    ecosystem = f.ecosystem;
    reserve = f.reserve;
    owner = f.owner;
    shipper = f.shipper;
  });

  it("01: should have correct name and symbol", async () => {
    expect(await haul.name()).to.equal("OpenHaul");
    expect(await haul.symbol()).to.equal("HAUL");
  });

  it("02: should have max supply of 100M", async () => {
    const max = await haul.MAX_SUPPLY();
    expect(max).to.equal(ethers.parseUnits("100000000", 18));
    expect(await haul.totalSupply()).to.equal(max);
  });

  it("03: should distribute allocations correctly", async () => {
    const max = await haul.MAX_SUPPLY();
    // fixtures transfers 700k HAUL from liquidity to test accounts
    const transferredOut = ethers.parseUnits("700000", 18);
    expect(await haul.balanceOf(await liquidity.getAddress())).to.equal(max * 15n / 100n - transferredOut);
    expect(await haul.balanceOf(await ecosystem.getAddress())).to.equal(max * 40n / 100n);
    expect(await haul.balanceOf(await reserve.getAddress())).to.equal(max * 25n / 100n);
  });

  it("04: should initialize team vesting", async () => {
    const vesting = await haul.teamVesting(await team.getAddress());
    expect(vesting.initialized).to.be.true;
    const max = await haul.MAX_SUPPLY();
    expect(vesting.totalAmount).to.equal(max * 20n / 100n);
  });

  it("05: should return zero releasable before cliff", async () => {
    expect(await haul.releasableAmount(await team.getAddress())).to.equal(0);
  });

  it("06: should allow burning tokens", async () => {
    const bal = await haul.balanceOf(await liquidity.getAddress());
    await haul.connect(liquidity).burn(ethers.parseUnits("1000", 18));
    expect(await haul.balanceOf(await liquidity.getAddress())).to.equal(bal - ethers.parseUnits("1000", 18));
    expect(await haul.totalSupply()).to.equal(await haul.MAX_SUPPLY() - ethers.parseUnits("1000", 18));
  });

  it("07: should report circulatingSupply as totalSupply", async () => {
    // P1 note: current implementation returns totalSupply() - 0 (locked not tracked)
    const circ = await haul.circulatingSupply();
    expect(circ).to.equal(await haul.totalSupply());
  });

  it("08: should release vested tokens after cliff + time", async () => {
    const fourYears = 4 * 365 * 24 * 60 * 60;
    await ethers.provider.send("evm_increaseTime", [fourYears + 1]);
    await ethers.provider.send("evm_mine");

    const releasable = await haul.releasableAmount(await team.getAddress());
    expect(releasable).to.be.gt(0);

    await haul.connect(team).releaseVestedTokens();
    const vesting = await haul.teamVesting(await team.getAddress());
    expect(vesting.releasedAmount).to.equal(vesting.totalAmount);
  });

  it("09: should not release twice", async () => {
    const fourYears = 4 * 365 * 24 * 60 * 60;
    await ethers.provider.send("evm_increaseTime", [fourYears + 1]);
    await ethers.provider.send("evm_mine");

    await haul.connect(team).releaseVestedTokens();
    await expect(haul.connect(team).releaseVestedTokens())
      .to.be.revertedWith("No tokens to release");
  });

  it("10: should revert release for non-beneficiary", async () => {
    await expect(haul.connect(shipper).releaseVestedTokens())
      .to.be.revertedWith("No vesting found");
  });
});
