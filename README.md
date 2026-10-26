# ChainEscrow — 基于 POTOS Testnet 的链上托管交易 DApp

ChainEscrow 是一个基于 **Scaffold-ETH 2、Next.js、Solidity 和 MetaMask** 构建的区块链托管交易应用。本项目采用课程大作业的 **路线 B（前端 DApp）**，使用部署在 **POTOS Testnet** 上的 `Escrow` 与 `ZWNToken` 合约，实现订单创建、ERC-20 代币支付、确认收货、争议发起和仲裁处理。

界面提供中文操作提示、订单统计、地址和状态筛选，以及基于真实合约事件的 **订单交易时间线（加分功能）**。所有写入链上的交易均由用户在自己的 MetaMask 钱包中确认和签名，前端不保存私钥。

## 1. 项目功能

| 功能 | 说明 |
| --- | --- |
| 钱包连接 | 通过 MetaMask 连接 POTOS Testnet，显示当前钱包及订单角色。 |
| 订单创建 | 买家填写卖家地址、代币数量、截止时间和订单描述，调用 `createOrder`。 |
| 订单支付 | 先调用 ERC-20 `approve`，待其确认后调用 Escrow 的 `deposit`；两步均需钱包签名。 |
| 确认收货 | 买家对已支付订单执行 `confirm`，将托管代币支付给卖家。 |
| 发起争议 | 已支付订单的买家或卖家可以调用 `dispute`。 |
| 仲裁处理 | 合约指定的仲裁人对争议订单调用 `resolve`，选择支付给卖家或退还买家。 |
| 订单状态与统计 | 从 `OrderCreated` 事件恢复订单列表，再通过 `getOrder` 读取真实状态；支持搜索、筛选和统计。 |
| **链上交易时间线** | 展开订单后，从 Escrow 合约事件读取创建、支付、确认、争议及仲裁记录，按区块和日志顺序排列，展示时间、区块号及浏览器链接。 |
| 交易记录 | 页面提供当前浏览器记录的交易历史；最终交易结果以区块链浏览器为准。 |

订单状态包括：`Created`（待付款）、`Paid`（已付款）、`Completed`（已完成）、`Refunded`（已退款）和 `Disputed`（争议中）。

> **安全提示：** 按角色显示按钮只是前端交互设计；真正的权限检查仍由智能合约完成。其他用户即使自行构造交易，也不能绕过合约的权限和状态判断。

## 2. 技术栈与项目结构

- **智能合约：** Solidity、Hardhat、ERC-20。
- **前端：** Next.js、React、TypeScript、Scaffold-ETH 2。
- **Web3 交互：** Wagmi、Viem、MetaMask。
- **网络：** POTOS Testnet（EVM 兼容测试网络）。

主要文件：

```text
packages/
├── hardhat/
│   ├── contracts/
│   │   ├── Escrow.sol
│   │   └── ZWNToken.sol
│   ├── deploy/
│   └── deployments/potos_testnet/
└── nextjs/
    ├── app/escrow/page.tsx
    ├── components/escrow/
    ├── contracts/deployedContracts.ts
    ├── hooks/scaffold-eth/
    ├── styles/globals.css
    └── utils/escrow.ts
```

页面入口：`/escrow`。合约 ABI 和部署地址保存在 `packages/nextjs/contracts/deployedContracts.ts` 中。

## 3. 网络与已部署合约

| 项目 | 值 |
| --- | --- |
| 网络 | POTOS Testnet |
| Chain ID | `60600` |
| RPC | `https://rpc-testnet.potos.hk` |
| Gas 代币 | `POT`（测试币） |
| 区块浏览器 | https://scan-testnet.potos.hk |
| 测试币领取 | https://faucet-testnet.potos.hk |
| Escrow 合约 | [`0x7A2a512E658446bd5F25EB484c9F97ADBe7c7afA`](https://scan-testnet.potos.hk/address/0x7A2a512E658446bd5F25EB484c9F97ADBe7c7afA) |
| ZWNToken 合约 | [`0x8FADbdEc0bF50eD568eE4dcC4e8C7848199ca92a`](https://scan-testnet.potos.hk/address/0x8FADbdEc0bF50eD568eE4dcC4e8C7848199ca92a) |
| 仲裁人账户 | `0xfdc6E5b9367449B4369003fb5B16ea0789013a26` |
| Escrow 部署区块 | `2669129` |

本项目的前端**直接复用以上已部署的测试网合约**。如果只是运行页面，**不需要启动本地区块链，也不要执行 `yarn deploy`**；重新部署会产生新的合约地址，与本报告的订单和交易记录不一致。

## 4. 安装与运行

### 环境要求

- **Node.js ≥ 20.18.3**。
- **Yarn 3.2.3**（根目录 `package.json` 指定的版本）。
- Git、浏览器和 MetaMask 扩展。
- 如需执行链上写入操作，钱包必须连接 POTOS Testnet 并有少量 `POT` 测试币支付 Gas。

克隆本仓库后，**在仓库根目录**执行：

```bash
corepack enable   # 已能使用正确版本 Yarn 时可跳过
yarn install
yarn start
```

根据终端提示打开页面，通常为：

- http://localhost:3000/escrow
- 若 3000 端口被占用，请使用终端实际显示的端口，例如 http://localhost:3001/escrow

连接 MetaMask 后，检查网络是否为 **POTOS Testnet（60600）**。查看订单不需要钱包持有测试币；创建、支付、确认、争议和仲裁等链上操作需要相应账户签名并支付 Gas。

### 环境变量

本项目提供 `packages/hardhat/.env.example` 和 `packages/nextjs/.env.example` 作为配置说明。前端部分可能涉及以下可选配置（以项目内实际示例文件为准）：

```dotenv
NEXT_PUBLIC_ALCHEMY_API_KEY=
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=
```

在需要时创建各包自己的本地 `.env` 或 `.env.local`，**不要把真实密钥、助记词或钱包私钥提交到 GitHub**。以上以 `NEXT_PUBLIC_` 开头的变量可能被打包到浏览器中，因此也**不应**存放秘密信息。课程路线 B 的签名由 MetaMask 完成，无需在前端配置任何钱包私钥。

## 5. 使用流程与权限

1. **创建订单：** 买家输入卖家地址、数量、截止时间和描述，在 MetaMask 确认 `createOrder`。
2. **支付：** 买家点击“支付”，依次确认 `approve` 和 `deposit` 两笔交易；代币转入 Escrow 合约。
3. **正常完成：** 买家点击“确认收货”，合约将托管代币转给卖家，订单状态成为 `Completed`。
4. **争议处理：** 买家或卖家可以对 `Paid` 状态的订单发起争议；只有指定仲裁人可以选择“判给卖家”或“退还买家”。
5. **查看时间线：** 在订单列表中点击“查看时间线”，展开对应订单的链上事件记录，可点击“查看交易”核对区块浏览器信息。

订单列表通过 Escrow 的 `OrderCreated` 历史事件获取 ID，并通过 `getOrder(id)` 获取最新状态。POTOS RPC 对事件查询范围有限制，因此页面采用**每批 10 个区块**的方式查询，历史起点为 Escrow 的部署区块 `2669129`。时间线仅显示在链上实际发生的事件，**不根据订单最终状态编造中间步骤**。

## 6. 已验证的演示结果

以下记录对应课程大作业路线 B 的实际测试，均为 **POTOS Testnet 测试代币**：

| 订单 | 金额 | 主要过程 | 最终状态 |
| --- | --- | --- | --- |
| `#3` | `30 ZWN` | `OrderCreated → OrderPaid → OrderCompleted` | `Completed` / 已完成，买家确认收货。 |
| `#4` | `30 ZWN` | `OrderCreated → OrderPaid → OrderDisputed → OrderResolved` | `Refunded` / 已退款，卖家发起争议，由仲裁人将代币退还买家。 |

交易时间线可展示相应事件的时间、区块高度和交易哈希，便于独立核对。`approve` 是 ZWNToken 合约的 ERC-20 授权交易，因此不会作为 Escrow 合约自身的时间线事件显示。

## 7. 链上交易记录

下表是已在实验中记录的关键交易。**所有交易哈希和账户都是公开的链上数据，并非私钥。** 点击“查看交易”可跳转到 POTOS 区块浏览器。

| 操作 | 交易哈希 | 区块浏览器链接 | 发起账户 |
| --- | --- | --- | --- |
| 部署 Escrow（实验 3） | `0x72810759c1ead34bd554f2c81e1fc7c75ce62eaa5d77427cc82eba4d802c0cf3` | [查看交易](https://scan-testnet.potos.hk/tx/0x72810759c1ead34bd554f2c81e1fc7c75ce62eaa5d77427cc82eba4d802c0cf3) | `0x891DCDd39972A017D4C2f7a479Bf23c3f4e4Ee3d` |
| `createOrder` 订单 #3 | `0x5a98a4c8f4286152d354b5ffb222590a5d5755033f86182371d2df640ad53870` | [查看交易](https://scan-testnet.potos.hk/tx/0x5a98a4c8f4286152d354b5ffb222590a5d5755033f86182371d2df640ad53870) | `0x891DCDd39972A017D4C2f7a479Bf23c3f4e4Ee3d` |
| `approve` 订单 #3 | `0x7142a72f6fb8d4f310ef7c0f90afe93c5ed74cc09055b3b62fe9c1a53f84e42d` | [查看交易](https://scan-testnet.potos.hk/tx/0x7142a72f6fb8d4f310ef7c0f90afe93c5ed74cc09055b3b62fe9c1a53f84e42d) | `0x891DCDd39972A017D4C2f7a479Bf23c3f4e4Ee3d` |
| `deposit` 订单 #3 | `0x733dd2430947a2365375cb9447dd24db62a51e5d4f22bd189fba240556f20298` | [查看交易](https://scan-testnet.potos.hk/tx/0x733dd2430947a2365375cb9447dd24db62a51e5d4f22bd189fba240556f20298) | `0x891DCDd39972A017D4C2f7a479Bf23c3f4e4Ee3d` |
| `confirm` 订单 #3 | `0xe7bd8fc03df8365812cc6acdf440fc93aed6a6ac588af1b03a2f23a0cccc0c11` | [查看交易](https://scan-testnet.potos.hk/tx/0xe7bd8fc03df8365812cc6acdf440fc93aed6a6ac588af1b03a2f23a0cccc0c11) | `0x891DCDd39972A017D4C2f7a479Bf23c3f4e4Ee3d` |
| `dispute` 订单 #4 | `0x4734ff5e0976d8ca565fb0b1133bdfd9979b1fa71c92959eaaec23d09a51b62e` | [查看交易](https://scan-testnet.potos.hk/tx/0x4734ff5e0976d8ca565fb0b1133bdfd9979b1fa71c92959eaaec23d09a51b62e) | `0x05801C9492eC2eA6200937eC2B3405Ba10CE1AA3` |
| `resolve` 订单 #4 | `0x7624199a7b36e295c4b4fed60d9abbed39ce897ef92561378828bea67abaf696` | [查看交易](https://scan-testnet.potos.hk/tx/0x7624199a7b36e295c4b4fed60d9abbed39ce897ef92561378828bea67abaf696) | `0xfdc6E5b9367449B4369003fb5B16ea0789013a26` |

> 注：订单 #4 的 `createOrder`、`approve` 和 `deposit` 也已在实验中执行，其事件可在页面时间线及区块浏览器中核对。本表首先列出报告 4.3 节使用的关键交易；如需完整流水，可补充上述三笔交易的已核实哈希。

## 8. 检查与安全

在仓库根目录可以运行：

```bash
yarn next:check-types
yarn next:lint
yarn test:escrow-ui
```

这些是**可执行的检查命令**，不代表每次推送前都已经通过；运行结果以本地终端输出为准。

发布代码前须检查：

- `.env`、`.env.local`、钱包私钥、助记词和其他敏感配置没有被 Git 跟踪。
- 已提交的部署文件只包含公开的合约地址、ABI、交易信息及其他非敏感数据。
- 前端连接的 Chain ID、RPC 与合约地址对应同一个 POTOS Testnet。
- 在 MetaMask 确认交易前核对调用地址、账户和金额。
- `approve` 和 `deposit` 是两笔不同的交易；如果中途取消，需要重新检查订单状态和授权额度。

本仓库包含课程实验代码和测试网演示结果，仅用于学习与演示，不应用于管理真实资产。

## 9. 加分实验：重入攻击挑战（6 分）

本项目除路线 B 的订单时间线（3 分）外，还完成了课程第 6.1 节的**重入攻击挑战（Reentrancy Challenge）**。该实验是**独立的安全演示**，不修改已有 ChainEscrow 合约和前端，也不针对第三方合约。

> ⚠️ **仅供教学：** \`VulnerableVault\` 故意保留重入漏洞。所有操作均在 POTOS Testnet 上使用自有实验合约与测试币完成，不能将漏洞示例部署用于保管真实资产。实验所用的 \`VulnerableVault.sol\`、\`Attacker.sol\` 和 \`FixedVault.sol\` 源文件将放入仓库的 \`reentrancy/\` 目录单独管理。

### 9.1 漏洞原理与修复

\`VulnerableVault.withdraw()\` 在向调用者转账之后，才执行 \`balances[msg.sender] = 0\`。攻击合约通过 \`receive()\` 在收到 POT 时再次调用 \`withdraw()\`，利用余额尚未清零的窗口重复提取资金。

\`FixedVault\` 将 \`balances[msg.sender] = 0\` 移到外部转账**之前**，遵循 **Checks-Effects-Interactions (CEI)** 原则：先检查条件、更新合约内部状态，最后与外部地址交互。重入时，原余额已经为 0，重复提取会失败，整笔攻击交易回滚。

这一原则与本项目 \`Escrow.sol\` 的部分处理逻辑一致。例如 \`confirm()\` 在执行 ERC-20 \`transfer\` 之前，先将订单状态更新为 \`Completed\`；\`resolve()\` 也先更新订单状态再转账。除此之外，合约还可以使用 \`ReentrancyGuard\`、提现式支付（Pull Payment）、严格的权限与状态检查以及安全测试等措施降低风险。

### 9.2 POTOS Testnet 实测结果

| 测试 | 初始操作 | 测试结果 |
| --- | --- | --- |
| 第一轮：\`VulnerableVault\` | 受害者账户存入 \`0.002 POT\`；攻击者通过 \`attack()\` 存入 \`0.001 POT\` | 攻击成功：\`VulnerableVault.vaultBalance() = 0\`，\`Attacker.attackerBalance() = 0.003 POT\`。 |
| 第二轮：\`FixedVault\` | 受害者账户存入 \`0.0001 POT\`；攻击者尝试使用 \`0.00005 POT\` 再次攻击 | 攻击交易失败（revert），\`FixedVault.vaultBalance() = 0.0001 POT\`，新攻击合约余额为 \`0\`。 |

上述余额均为实验中在 Remix 查询的结果；这里的 POT 是测试网代币。若交易回滚，附带的转账也会回滚，但链上交易仍可能消耗 Gas。

### 9.3 攻击交易记录

| 操作 | 交易哈希 | 区块 | 状态 | 浏览器 |
| --- | --- | --- | --- | --- |
| \`Attacker.attack()\` → \`VulnerableVault\` | \`0x472c091e773e96e690f5c9ee6fb470ef02ef7f5d313495abb952b62ce92b1664\` | \`2688706\` | \`Success\` | [查看成功交易](https://scan-testnet.potos.hk/tx/0x472c091e773e96e690f5c9ee6fb470ef02ef7f5d313495abb952b62ce92b1664) |
| \`Attacker.attack()\` → \`FixedVault\` | \`0xb3129e805ff1d8c67f2a61c54deebdcfb5eb9c254bdc975a7bf85cb782d3f31e\` | \`2688902\` | \`Failed\` | [查看失败交易](https://scan-testnet.potos.hk/tx/0xb3129e805ff1d8c67f2a61c54deebdcfb5eb9c254bdc975a7bf85cb782d3f31e) |

POTOS 区块浏览器当前不一定提供完整的 **Internal Transactions** 列表，因此实验报告将交易状态与链上余额变化结合起来作为重入攻击成功及修复有效的证据；不声称浏览器已经显示多次内部 \`withdraw()\` 调用。

课程报告的证明材料依次编号为 **4C-1（余额变化）**、**4C-2（成功攻击交易）** 和 **4C-3（修复后失败交易及保留余额）**。

## 10. 课程说明

本项目属于“在区块链上构建应用系统”课程大作业，选择 **路线 B**。订单时间线（3 分）和独立的重入攻击挑战（6 分）均已完成实验并整理对应证据。两项加分能否计入最终成绩由教师评定；重入实验不属于 Escrow 页面核心功能。
