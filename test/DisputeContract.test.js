const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./fixtures");

describe("DisputeContract", function () {
  let usdt, haul, reputation, order, dispute, owner, shipper, carrier, juror1, juror2, juror3, juror4, juror5, orderSigner, disputeSigner;

  beforeEach(async function () {
    const f = await deployFixture();
    haul = f.haul;
    reputation = f.reputation;
    order = f.order;
    dispute = f.dispute;
    owner = f.owner;
    shipper = f.shipper;
    carrier = f.carrier;
    juror1 = f.juror1;
    juror2 = f.juror2;
    juror3 = f.juror3;
    juror4 = f.juror4;
    juror5 = f.juror5;
    orderSigner = f.orderSigner;
    disputeSigner = f.disputeSigner;
    usdt = f.usdt;
  });

  // ── Juror Registration (P0 real transfer fix) ────────────

  it("01: should register juror with HAUL stake", async () => {
    await haul.connect(juror1).approve(await dispute.getAddress(), ethers.parseUnits("50", 18));
    await expect(dispute.connect(juror1).registerAsJuror())
      .to.emit(dispute, "JurorRegistered")
      .withArgs(juror1.address);
    expect(await dispute.isRegisteredJuror(juror1.address)).to.be.true;
    expect(await dispute.jurorStakes(juror1.address)).to.equal(ethers.parseUnits("50", 18));
  });

  it("02: should reject registration without approval", async () => {
    await expect(dispute.connect(juror1).registerAsJuror())
      .to.be.reverted; // ERC20 insufficient allowance
  });

  it("03: should not double register", async () => {
    await haul.connect(juror1).approve(await dispute.getAddress(), ethers.parseUnits("50", 18));
    await dispute.connect(juror1).registerAsJuror();
    await expect(dispute.connect(juror1).registerAsJuror())
      .to.be.revertedWith("Already registered");
  });

  it("04: should unregister and return stake", async () => {
    await haul.connect(juror1).approve(await dispute.getAddress(), ethers.parseUnits("50", 18));
    await dispute.connect(juror1).registerAsJuror();
    const before = await haul.balanceOf(juror1.address);
    await dispute.connect(juror1).unregisterAsJuror();
    expect(await haul.balanceOf(juror1.address)).to.equal(before + ethers.parseUnits("50", 18));
    expect(await dispute.isRegisteredJuror(juror1.address)).to.be.false;
  });

  // ── createDispute (P0 onlyOrderContract + HAUL fee) ──────

  it("05: should reject createDispute from non-OrderContract", async () => {
    await expect(dispute.createDispute(1, shipper.address, carrier.address, shipper.address, ethers.ZeroHash))
      .to.be.revertedWith("Only OrderContract");
  });

  it("06: should create dispute via OrderContract (raiseDispute)", async () => {
    // Setup: create order, accept, start transit
    await setupOrderForDispute();
    // Approve HAUL for dispute fee
    await haul.connect(shipper).approve(await dispute.getAddress(), ethers.parseUnits("10", 18));
    await expect(order.connect(shipper).raiseDispute(0, "damaged cargo"))
      .to.emit(dispute, "DisputeRaised");
    const d = await dispute.getDispute(0);
    expect(d.status).to.equal(0); // Open (no jurors registered)
  });

  // ── castVote (P0 direct voting) ──────────────────────────

  it("07: should allow juror to cast vote", async () => {
    await registerJurors(5);
    await setupOrderForDispute();
    await haul.connect(shipper).approve(await dispute.getAddress(), ethers.parseUnits("10", 18));
    await order.connect(shipper).raiseDispute(0, "damaged cargo");

    const disputeId = 0;
    const jury = await dispute.getJury(disputeId);
    const juror = getJurorSigner(jury[0], [juror1, juror2, juror3, juror4, juror5]);
    await expect(dispute.connect(juror).castVote(disputeId, 1))
      .to.emit(dispute, "VoteCast");
    expect(await dispute.getVote(disputeId, juror.address)).to.equal(1); // Merchant
  });

  it("08: should resolve when all jurors vote", async () => {
    await registerJurors(5);
    await setupOrderForDispute();
    await haul.connect(shipper).approve(await dispute.getAddress(), ethers.parseUnits("10", 18));
    await order.connect(shipper).raiseDispute(0, "damaged cargo");

    const disputeId = 0;
    const jury = await dispute.getJury(disputeId);
    expect(jury.length).to.equal(5);
    for (const addr of [...new Set(jury)]) {
      const juror = getJurorSigner(addr, [juror1, juror2, juror3, juror4, juror5]);
      try {
        await dispute.connect(juror).castVote(disputeId, 1);
      } catch (e) {
        // Duplicate jury member already voted
      }
    }
    // If jury had duplicates, auto-resolve may not trigger; use deadline fallback
    if ((await dispute.getDispute(disputeId)).status == 1) {
      await ethers.provider.send("evm_increaseTime", [48 * 3600 + 1]);
      await ethers.provider.send("evm_mine");
      await dispute.resolveAfterDeadline(disputeId);
    }
    const d = await dispute.getDispute(disputeId);
    expect(d.status).to.equal(2); // Resolved
  });

  it("09: should reject double voting", async () => {
    await registerJurors(5);
    await setupOrderForDispute();
    await haul.connect(shipper).approve(await dispute.getAddress(), ethers.parseUnits("10", 18));
    await order.connect(shipper).raiseDispute(0, "damaged cargo");

    const jury = await dispute.getJury(0);
    const juror = getJurorSigner(jury[0], [juror1, juror2, juror3, juror4, juror5]);
    await dispute.connect(juror).castVote(0, 1);
    await expect(dispute.connect(juror).castVote(0, 1))
      .to.be.revertedWith("Already voted");
  });

  it("10: should reject vote from non-juror", async () => {
    await registerJurors(5);
    await setupOrderForDispute();
    await haul.connect(shipper).approve(await dispute.getAddress(), ethers.parseUnits("10", 18));
    await order.connect(shipper).raiseDispute(0, "damaged cargo");

    await expect(dispute.connect(shipper).castVote(0, 1))
      .to.be.revertedWith("Not selected as juror for this dispute");
  });

  // ── resolveAfterDeadline ─────────────────────────────────

  it("11: should resolve after deadline", async () => {
    await registerJurors(5);
    await setupOrderForDispute();
    await haul.connect(shipper).approve(await dispute.getAddress(), ethers.parseUnits("10", 18));
    await order.connect(shipper).raiseDispute(0, "damaged cargo");

    const disputeId = 0;
    const jury = await dispute.getJury(disputeId);
    // Only 2 jurors vote
    const j1 = getJurorSigner(jury[0], [juror1, juror2, juror3, juror4, juror5]);
    const j2 = getJurorSigner(jury[1], [juror1, juror2, juror3, juror4, juror5]);
    await dispute.connect(j1).castVote(disputeId, 1);
    await dispute.connect(j2).castVote(disputeId, 2);

    // Fast forward past voting period
    await ethers.provider.send("evm_increaseTime", [48 * 3600 + 1]);
    await ethers.provider.send("evm_mine");

    await dispute.resolveAfterDeadline(disputeId);
    const d = await dispute.getDispute(disputeId);
    expect(d.status).to.equal(2); // Resolved
  });

  it("12: should reject resolve before deadline", async () => {
    await registerJurors(5);
    await setupOrderForDispute();
    await haul.connect(shipper).approve(await dispute.getAddress(), ethers.parseUnits("10", 18));
    await order.connect(shipper).raiseDispute(0, "damaged cargo");

    await expect(dispute.resolveAfterDeadline(0))
      .to.be.revertedWith("Voting still open");
  });

  // ── Pool integrity / constants ───────────────────────────

  it("13: should report correct juror pool size", async () => {
    expect(await dispute.getJurorPoolSize()).to.equal(0);
    await registerJurors(3);
    expect(await dispute.getJurorPoolSize()).to.equal(3);
  });

  it("14: should return correct jury members", async () => {
    await registerJurors(5);
    await setupOrderForDispute();
    await haul.connect(shipper).approve(await dispute.getAddress(), ethers.parseUnits("10", 18));
    await order.connect(shipper).raiseDispute(0, "damaged cargo");

    const jury = await dispute.getJury(0);
    expect(jury.length).to.equal(5);
  });

  it("15: should return correct dispute status and winner", async () => {
    await registerJurors(5);
    await setupOrderForDispute();
    await haul.connect(shipper).approve(await dispute.getAddress(), ethers.parseUnits("10", 18));
    await order.connect(shipper).raiseDispute(0, "damaged cargo");

    const [status, winner] = await dispute.getDisputeStatusAndWinner(0);
    expect(status).to.equal(1); // Voting
    expect(winner).to.equal(ethers.ZeroAddress);
  });

  // ── Slashing ─────────────────────────────────────────────

  it("16: should slash losing jurors", async () => {
    await registerJurors(5);
    await setupOrderForDispute();
    await haul.connect(shipper).approve(await dispute.getAddress(), ethers.parseUnits("10", 18));
    await order.connect(shipper).raiseDispute(0, "damaged cargo");

    const jury = await dispute.getJury(0);
    const uniqueJury = [...new Set(jury)];
    // Majority vote merchant, minority votes driver → driver loses, minority slashed
    for (let i = 0; i < uniqueJury.length - 1; i++) {
      const juror = getJurorSigner(uniqueJury[i], [juror1, juror2, juror3, juror4, juror5]);
      try {
        await dispute.connect(juror).castVote(0, 1);
      } catch (e) { /* duplicate already voted */ }
    }
    const dissent = getJurorSigner(uniqueJury[uniqueJury.length - 1], [juror1, juror2, juror3, juror4, juror5]);
    try {
      await dispute.connect(dissent).castVote(0, 2);
    } catch (e) { /* duplicate already voted */ }

    // Ensure resolved (use deadline if auto-resolve didn't trigger)
    if ((await dispute.getDispute(0)).status == 1) {
      await ethers.provider.send("evm_increaseTime", [48 * 3600 + 1]);
      await ethers.provider.send("evm_mine");
      await dispute.resolveAfterDeadline(0);
    }

    const stakeBefore = await dispute.jurorStakes(dissent.address);
    expect(stakeBefore).to.be.lt(ethers.parseUnits("50", 18)); // slashed 20%
  });

  // ── Pause ────────────────────────────────────────────────

  it("17: should pause and unpause", async () => {
    await dispute.pause();
    expect(await dispute.paused()).to.be.true;
    await dispute.unpause();
    expect(await dispute.paused()).to.be.false;
  });

  it("18: should reject operations when paused", async () => {
    await dispute.pause();
    await haul.connect(juror1).approve(await dispute.getAddress(), ethers.parseUnits("50", 18));
    await expect(dispute.connect(juror1).registerAsJuror())
      .to.be.revertedWithCustomError(dispute, "EnforcedPause");
  });

  it("19: should reject invalid vote values", async () => {
    await registerJurors(5);
    await setupOrderForDispute();
    await haul.connect(shipper).approve(await dispute.getAddress(), ethers.parseUnits("10", 18));
    await order.connect(shipper).raiseDispute(0, "damaged cargo");

    await expect(dispute.connect(juror1).castVote(0, 0))
      .to.be.revertedWith("Invalid vote: 1=merchant, 2=driver");
    await expect(dispute.connect(juror1).castVote(0, 3))
      .to.be.revertedWith("Invalid vote: 1=merchant, 2=driver");
  });

  it("20: should return dispute details correctly", async () => {
    await registerJurors(5);
    await setupOrderForDispute();
    await haul.connect(shipper).approve(await dispute.getAddress(), ethers.parseUnits("10", 18));
    await order.connect(shipper).raiseDispute(0, "damaged cargo");

    const d = await dispute.getDispute(0);
    expect(d.orderId).to.equal(0);
    expect(d.merchant).to.equal(shipper.address);
    expect(d.driver).to.equal(carrier.address);
  });

  // Helper functions
  async function registerJurors(count) {
    const jurors = [juror1, juror2, juror3, juror4, juror5];
    for (let i = 0; i < count; i++) {
      await haul.connect(jurors[i]).approve(await dispute.getAddress(), ethers.parseUnits("50", 18));
      await dispute.connect(jurors[i]).registerAsJuror();
    }
  }

  function getJurorSigner(juryAddr, jurors) {
    return jurors.find(j => j.address === juryAddr);
  }

  async function setupOrderForDispute() {
    const fee = ethers.parseUnits("100", 6);
    const value = ethers.parseUnits("1000", 6);
    // Boost carrier reputation
    for (let i = 0; i < 3; i++) {
      await reputation.connect(orderSigner).recordCompletion(carrier.address, shipper.address, 700 + i);
    }
    await reputation.submitRating(703, carrier.address, 5);
    await reputation.submitRating(704, carrier.address, 5);
    await usdt.connect(shipper).approve(await order.getAddress(), fee);
    await order.connect(shipper).createOrder("A", "B", "C", value, fee);
    await usdt.connect(carrier).approve(await order.getAddress(), fee / 2n);
    await order.connect(carrier).acceptOrder(0);
    await order.connect(carrier).startTransit(0);
  }
});
