import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { isAddress, ZeroAddress } from "ethers";

const deployEscrow: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const ARBITER = process.env.ESCROW_ARBITER;

  if (!ARBITER || !isAddress(ARBITER) || ARBITER.toLowerCase() === ZeroAddress.toLowerCase()) {
    throw new Error("Debes configurar una direccion valida para ESCROW_ARBITER");
  }

  await hre.deployments.deploy("Escrow", {
    from: deployer,
    args: [ARBITER],
    log: true,
    autoMine: true,
  });
};

export default deployEscrow;

deployEscrow.tags = ["EscrowZWN202469990646"];
