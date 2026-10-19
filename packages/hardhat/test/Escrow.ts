import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const AMOUNT = ethers.parseUnits("30", 18);

async function deployFixture() {
  const [deployer, buyer, seller, arbiter, stranger] = await ethers.getSigners();

  const token = await ethers.deployContract("ZWNToken");
  await token.waitForDeployment();

  await token.mint(buyer.address, ethers.parseUnits("100", 18));

  const escrow = await ethers.deployContract("Escrow", [arbiter.address]);

  await escrow.waitForDeployment();

  const deadline = (await time.latest()) + 3600;

  return {
    token,
    escrow,
    deployer,
    buyer,
    seller,
    arbiter,
    stranger,
    deadline,
  };
}

// Funcion auxiliar para crear una orden
async function createTestOrder() {
  const data = await loadFixture(deployFixture);

  await data.escrow
    .connect(data.buyer)
    .createOrder(data.seller.address, await data.token.getAddress(), AMOUNT, data.deadline, "一本书");

  return data;
}

// Funcion auxiliar para crear y pagar una orden
async function createPaidOrder() {
  const data = await createTestOrder();

  await data.token.connect(data.buyer).approve(await data.escrow.getAddress(), AMOUNT);

  await data.escrow.connect(data.buyer).deposit(0);

  return data;
}

describe("Escrow", function () {
  // TEST 1
  it("createOrder 记录订单并发出事件", async function () {
    const { token, escrow, buyer, seller, deadline } = await loadFixture(deployFixture);

    await expect(
      escrow.connect(buyer).createOrder(seller.address, await token.getAddress(), AMOUNT, deadline, "一本书"),
    )
      .to.emit(escrow, "OrderCreated")
      .withArgs(0, buyer.address, seller.address, await token.getAddress(), AMOUNT, deadline);

    const order = await escrow.getOrder(0);

    expect(order.buyer).to.equal(buyer.address);
    expect(order.status).to.equal(0n);
    expect(await escrow.orderCount()).to.equal(1n);
  });

  // TEST 2
  it("未 approve 时 deposit 失败", async function () {
    const { escrow, buyer } = await createTestOrder();

    await expect(escrow.connect(buyer).deposit(0)).to.be.revertedWith("ZWNToken: insufficient allowance");
  });

  // TEST 3
  it("approve 后 deposit 成功，代币进入 Escrow，状态变为 Paid", async function () {
    const { token, escrow } = await createPaidOrder();

    expect(await token.balanceOf(await escrow.getAddress())).to.equal(AMOUNT);

    const order = await escrow.getOrder(0);

    expect(order.status).to.equal(1n);
  });

  // TEST 4
  it("非买家调用 confirm 失败", async function () {
    const { escrow, stranger } = await createPaidOrder();

    await expect(escrow.connect(stranger).confirm(0)).to.be.revertedWith("Escrow: caller is not the buyer");
  });

  // TEST 5
  it("confirm 后卖家收到代币，状态变为 Completed", async function () {
    const { token, escrow, buyer, seller } = await createPaidOrder();

    await expect(escrow.connect(buyer).confirm(0)).to.emit(escrow, "OrderCompleted");

    expect(await token.balanceOf(seller.address)).to.equal(AMOUNT);

    expect((await escrow.getOrder(0)).status).to.equal(2n);
  });

  // TEST 6
  it("deadline 之前 refund 失败，deadline 之后 refund 成功并退回买家", async function () {
    const { token, escrow, buyer } = await createPaidOrder();

    await expect(escrow.connect(buyer).refund(0)).to.be.revertedWith("Escrow: deadline not reached");

    await time.increase(3601);

    await escrow.connect(buyer).refund(0);

    expect((await escrow.getOrder(0)).status).to.equal(3n);

    expect(await token.balanceOf(buyer.address)).to.equal(ethers.parseUnits("100", 18));
  });

  // TEST 7
  it("非仲裁人调用 resolve 失败", async function () {
    const { escrow, buyer, stranger } = await createPaidOrder();

    await escrow.connect(buyer).dispute(0);

    await expect(escrow.connect(stranger).resolve(0, true)).to.be.revertedWith("Escrow: caller is not the arbiter");
  });

  // TEST 8
  it("dispute 后仲裁人 resolve(false) 退款给买家，状态变为 Refunded", async function () {
    const { token, escrow, buyer, seller, arbiter } = await createPaidOrder();

    await escrow.connect(seller).dispute(0);

    expect((await escrow.getOrder(0)).status).to.equal(4n);

    await expect(escrow.connect(arbiter).resolve(0, false)).to.emit(escrow, "OrderResolved").withArgs(0, false);

    expect((await escrow.getOrder(0)).status).to.equal(3n);

    expect(await token.balanceOf(buyer.address)).to.equal(ethers.parseUnits("100", 18));
  });
});
