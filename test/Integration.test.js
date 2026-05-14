const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./fixtures");

describe("Integration", function () {
  let usdt, reputation, order, dispute, shipper, carrier, owner, orderSigner, disputeSigner;

  beforeEach(async function () {
    const f = await deployFixture();
    usdt = f.usdt;
    reputation = f.reputation;
    order = f.order;
    dispute = f.dispute;
    shipper = f.shipper;
    carrier = f.carrier;
    owner = f.owner;
    orderSigner = f.orderSigner;
    disputeSigner = f.disputeSigner;
  });

  async function boost(addr) {
    for (let i = 0; i < 3; i++) {
      await reputation.connect(orderSigner).recordCompletion(addr, shipper.address, 900 + i);
    }
    await reputation.submitRating(901, addr, 5);
    await reputation.submitRating(902, addr, 5);
  }

  async function createAndAccept(fee) {
    await usdt.connect(shipper).approve(await order.getAddress(), fee);
    await order.connect(shipper).createOrder("A", "B", "C", 1000, fee);
    await boost(carrier.address);
    const collateral = fee * 5000n / 10000n;
    await usdt.connect(carrier).approve(await order.getAddress(), collateral);
    await order.connect(carrier).acceptOrder(0);
  }

  it("01: happy path end-to-end", async () => {
    const fee = ethers.parseUnits("100", 6);
    await createAndAccept(fee);
    await order.connect(carrier).startTransit(0);
    await order.connect(carrier).markDelivered(0);
    await expect(order.connect(shipper).confirmDelivery(0))
      .to.emit(order, "OrderConfirmed");
    expect((await order.getOrder(0)).status).to.equal(9); // Completed (auto-settled)
  });

  it("02: rating after completion", async () => {
    const fee = ethers.parseUnits("100", 6);
    await createAndAccept(fee);
    await order.connect(carrier).startTransit(0);
    await order.connect(carrier).markDelivered(0);
    await order.connect(shipper).confirmDelivery(0);

    await order.connect(shipper).rateCounterparty(0, true);

    const score = await reputation.getScore(carrier.address);
    expect(score.ratingCount).to.be.gt(0);
  });

  it("03: multiple orders in parallel", async () => {
    const fee = ethers.parseUnits("100", 6);
    for (let i = 0; i < 3; i++) {
      await usdt.connect(shipper).approve(await order.getAddress(), fee * BigInt(i + 1));
      await order.connect(shipper).createOrder("A", "B", "C", 1000, fee * BigInt(i + 1));
    }
    const list = await order.getShipperOrders(shipper.address);
    expect(list.length).to.equal(3);
  });

  it("04: autoConfirm after timeout", async () => {
    const fee = ethers.parseUnits("100", 6);
    await createAndAccept(fee);
    await order.connect(carrier).startTransit(0);
    await order.connect(carrier).markDelivered(0);

    await ethers.provider.send("evm_increaseTime", [4 * 24 * 3600]);
    await ethers.provider.send("evm_mine");

    await order.autoConfirm(0);
    expect((await order.getOrder(0)).status).to.equal(9);
  });

  it("05: shipper cancel before acceptance", async () => {
    const fee = ethers.parseUnits("100", 6);
    await usdt.connect(shipper).approve(await order.getAddress(), fee);
    await order.connect(shipper).createOrder("A", "B", "C", 1000, fee);
    const before = await usdt.balanceOf(shipper.address);
    await order.connect(shipper).cancelOrder(0);
    const after = await usdt.balanceOf(shipper.address);
    expect(after).to.equal(before + fee);
    expect((await order.getOrder(0)).status).to.equal(8); // Cancelled
  });

  it("06: P1 per-order rating (same rater, different orders)", async () => {
    const fee = ethers.parseUnits("100", 6);
    // Pre-boost carrier reputation once
    for (let i = 0; i < 3; i++) {
      await reputation.connect(orderSigner).recordCompletion(carrier.address, shipper.address, 800 + i);
    }
    await reputation.submitRating(803, carrier.address, 5);
    await reputation.submitRating(804, carrier.address, 5);

    for (let i = 0; i < 2; i++) {
      await usdt.connect(shipper).approve(await order.getAddress(), fee);
      await order.connect(shipper).createOrder("A", "B", "C", 1000, fee);
      await usdt.connect(carrier).approve(await order.getAddress(), fee / 2n);
      await order.connect(carrier).acceptOrder(i);
      await order.connect(carrier).startTransit(i);
      await order.connect(carrier).markDelivered(i);
      await order.connect(shipper).confirmDelivery(i);
    }

    // Rate both orders — same rater (shipper), different orderIds
    await order.connect(shipper).rateCounterparty(0, true);
    await order.connect(shipper).rateCounterparty(1, true);

    const score = await reputation.getScore(carrier.address);
    expect(score.ratingCount).to.equal(4); // 2 from boost + 2 from orders
  });
});
