const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./fixtures");

describe("ReputationContract", function () {
  let reputation, order, dispute, owner, shipper, carrier, orderSigner, disputeSigner;

  beforeEach(async function () {
    const f = await deployFixture();
    reputation = f.reputation;
    order = f.order;
    dispute = f.dispute;
    owner = f.owner;
    shipper = f.shipper;
    carrier = f.carrier;
    orderSigner = f.orderSigner;
    disputeSigner = f.disputeSigner;
  });

  // ── Access Control ───────────────────────────────────────

  it("01: only owner can authorize callers", async () => {
    await expect(reputation.connect(shipper).authorizeCaller(shipper.address))
      .to.be.revertedWith("Not owner");
  });

  it("02: authorized callers can record completion", async () => {
    await expect(reputation.connect(orderSigner).recordCompletion(carrier.address, shipper.address, 1))
      .to.emit(reputation, "CompletionRecorded")
      .withArgs(carrier.address, shipper.address, 1);
  });

  it("03: unauthorized caller cannot record completion", async () => {
    await expect(reputation.recordCompletion(carrier.address, shipper.address, 1))
      .to.be.revertedWith("Not authorized caller");
  });

  it("04: owner can revoke caller", async () => {
    await reputation.revokeCaller(await order.getAddress());
    expect(await reputation.authorizedCallers(await order.getAddress())).to.be.false;
  });

  // ── recordCompletion ─────────────────────────────────────

  it("05: recordCompletion increments completedOrders", async () => {
    await reputation.connect(orderSigner).recordCompletion(carrier.address, shipper.address, 1);
    const s = await reputation.getScore(carrier.address);
    expect(s.completedOrders).to.equal(1);
  });

  it("06: recordCompletion updates lastActivityAt", async () => {
    await reputation.connect(orderSigner).recordCompletion(carrier.address, shipper.address, 1);
    const s = await reputation.getScore(carrier.address);
    expect(s.lastActivityAt).to.be.gt(0);
  });

  it("07: recordCompletion initializes new accounts", async () => {
    await reputation.connect(orderSigner).recordCompletion(carrier.address, shipper.address, 1);
    const s = await reputation.getScore(carrier.address);
    expect(s.firstActivityAt).to.be.gt(0);
  });

  // ── recordDisputeOutcome ─────────────────────────────────

  it("08: recordDisputeOutcome updates disputesWon/Lost", async () => {
    await reputation.connect(disputeSigner).recordDisputeOutcome(carrier.address, shipper.address);
    const winner = await reputation.getScore(carrier.address);
    const loser = await reputation.getScore(shipper.address);
    expect(winner.disputesWon).to.equal(1);
    expect(loser.disputesLost).to.equal(1);
  });

  it("09: recordDisputeOutcome emits event", async () => {
    await expect(reputation.connect(disputeSigner).recordDisputeOutcome(carrier.address, shipper.address))
      .to.emit(reputation, "DisputeOutcomeRecorded")
      .withArgs(carrier.address, shipper.address);
  });

  // ── submitRating (P1 per-order fix) ──────────────────────

  it("10: submitRating stores rating per order", async () => {
    await reputation.submitRating(1, carrier.address, 5);
    const s = await reputation.getScore(carrier.address);
    expect(s.totalRatingPoints).to.equal(5);
    expect(s.ratingCount).to.equal(1);
  });

  it("11: submitRating emits RatingSubmitted", async () => {
    await expect(reputation.submitRating(1, carrier.address, 4))
      .to.emit(reputation, "RatingSubmitted")
      .withArgs(1, carrier.address, 4);
  });

  it("12: cannot rate same order twice (P1 fix)", async () => {
    await reputation.submitRating(1, carrier.address, 5);
    await expect(reputation.submitRating(1, carrier.address, 3))
      .to.be.revertedWith("Already rated this order");
  });

  it("13: different orders can be rated (P1 fix)", async () => {
    await reputation.submitRating(1, carrier.address, 5);
    await reputation.submitRating(2, carrier.address, 4);
    const s = await reputation.getScore(carrier.address);
    expect(s.ratingCount).to.equal(2);
  });

  it("14: rating must be 1-5", async () => {
    await expect(reputation.submitRating(1, carrier.address, 0))
      .to.be.revertedWith("Rating must be 1-5");
    await expect(reputation.submitRating(1, carrier.address, 6))
      .to.be.revertedWith("Rating must be 1-5");
  });

  // ── getAverageRating ─────────────────────────────────────

  it("15: getAverageRating returns 0 for no ratings", async () => {
    expect(await reputation.getAverageRating(carrier.address)).to.equal(0);
  });

  it("16: getAverageRating calculates correctly", async () => {
    await reputation.submitRating(1, carrier.address, 5);
    await reputation.submitRating(2, carrier.address, 3);
    expect(await reputation.getAverageRating(carrier.address)).to.equal(4);
  });

  // ── getCompletionRate ────────────────────────────────────

  it("17: getCompletionRate returns 0 for no activity", async () => {
    expect(await reputation.getCompletionRate(carrier.address)).to.equal(0);
  });

  it("18: getCompletionRate 100% when no lost disputes", async () => {
    await reputation.connect(orderSigner).recordCompletion(carrier.address, shipper.address, 1);
    expect(await reputation.getCompletionRate(carrier.address)).to.equal(10000);
  });

  it("19: getCompletionRate penalizes lost disputes", async () => {
    await reputation.connect(orderSigner).recordCompletion(carrier.address, shipper.address, 1);
    await reputation.connect(disputeSigner).recordDisputeOutcome(shipper.address, carrier.address);
    // 1 completed, 1 lost → 50%
    expect(await reputation.getCompletionRate(carrier.address)).to.equal(5000);
  });

  // ── getCompositeScore ────────────────────────────────────

  it("20: getCompositeScore returns 0 for new account", async () => {
    expect(await reputation.getCompositeScore(carrier.address)).to.equal(0);
  });

  it("21: getCompositeScore increases with completions", async () => {
    await reputation.connect(orderSigner).recordCompletion(carrier.address, shipper.address, 1);
    const score = await reputation.getCompositeScore(carrier.address);
    expect(score).to.be.gt(0);
  });

  it("22: getCompositeScore increases with ratings", async () => {
    await reputation.connect(orderSigner).recordCompletion(carrier.address, shipper.address, 1);
    await reputation.submitRating(1, carrier.address, 5);
    const scoreWithRating = await reputation.getCompositeScore(carrier.address);
    expect(scoreWithRating).to.be.gt(0);
  });

  it("23: getCompositeScore capped at 100", async () => {
    // Massive completions + perfect ratings
    for (let i = 0; i < 20; i++) {
      await reputation.connect(orderSigner).recordCompletion(carrier.address, shipper.address, i + 1);
      await reputation.submitRating(i + 1, carrier.address, 5);
    }
    expect(await reputation.getCompositeScore(carrier.address)).to.be.lte(100);
  });

  // ── meetsThreshold ───────────────────────────────────────

  it("24: meetsThreshold false for new account", async () => {
    expect(await reputation.meetsThreshold(carrier.address, 1)).to.be.false;
  });

  it("25: meetsThreshold true after activity", async () => {
    await reputation.connect(orderSigner).recordCompletion(carrier.address, shipper.address, 1);
    expect(await reputation.meetsThreshold(carrier.address, 1)).to.be.true;
  });

  // ── Score struct read ────────────────────────────────────

  it("26: getScore returns full struct", async () => {
    await reputation.connect(orderSigner).recordCompletion(carrier.address, shipper.address, 1);
    const s = await reputation.getScore(carrier.address);
    expect(s.completedOrders).to.equal(1);
    expect(s.disputesLost).to.equal(0);
    expect(s.disputesWon).to.equal(0);
    expect(s.ratingCount).to.equal(0);
  });
});
