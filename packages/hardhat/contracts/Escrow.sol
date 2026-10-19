// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

// 用于与 ERC20 代币交互的接口
interface IERC20 {
    function transfer(address to, uint256 value)
        external returns (bool);

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool);

    function balanceOf(address account)
        external view returns (uint256);
}

contract Escrow {

    // 订单的不同状态
    enum Status {
        Created,
        Paid,
        Completed,
        Refunded,
        Disputed
    }

    // 每个订单的信息
    struct Order {
        address buyer;
        address seller;
        address token;
        uint256 amount;
        uint256 deadline;
        Status status;
        string description;
    }

    // 数据存储
    address public arbiter;
    uint256 public orderCount;

    mapping(uint256 => Order) private _orders;

    // 事件定义
    event OrderCreated(
        uint256 indexed id,
        address indexed buyer,
        address indexed seller,
        address token,
        uint256 amount,
        uint256 deadline
    );
    event OrderPaid(uint256 indexed id);
    event OrderCompleted(uint256 indexed id);
    event OrderRefunded(uint256 indexed id);
    event OrderDisputed(
        uint256 indexed id,
        address by
    );
    event OrderResolved(
        uint256 indexed id,
        bool sellerWins
    );

    // 修饰器
    modifier onlyArbiter() {
        require(
            msg.sender == arbiter,
            "Escrow: caller is not the arbiter"
        );
        _;
    }
    modifier onlyBuyer(uint256 id) {
        require(
            msg.sender == _orders[id].buyer,
            "Escrow: caller is not the buyer"
        );
        _;
    }
    modifier inStatus(uint256 id, Status s) {
        require(
            _orders[id].status == s,
            "Escrow: wrong status"
        );
        _;
    }
    constructor(address _arbiter) {
        require(
            _arbiter != address(0),
            "Escrow: arbiter is the zero address"
        );
        arbiter = _arbiter;
    }
    function getOrder(uint256 id)
        public
        view
        returns (Order memory)
    {
        require(
            id < orderCount,
            "Escrow: order does not exist"
        );

        return _orders[id];
    }
// 功能1：创建订单
function createOrder(
    address seller,
    address token,
    uint256 amount,
    uint256 deadline,
    string memory description
) public returns (uint256) {
    require(
        seller != address(0),
        "Escrow: invalid seller"
    );
    require(
        seller != msg.sender,
        "Escrow: buyer cannot be seller"
    );
    require(
        token != address(0),
        "Escrow: invalid token"
    );
    require(
        amount > 0,
        "Escrow: amount must be positive"
    );
    require(
        deadline > block.timestamp,
        "Escrow: deadline must be in the future"
    );
    uint256 id = orderCount;
    _orders[id] = Order({
        buyer: msg.sender,
        seller: seller,
        token: token,
        amount: amount,
        deadline: deadline,
        status: Status.Created,
        description: description
    });
    orderCount++;
    emit OrderCreated(
        id,
        msg.sender,
        seller,
        token,
        amount,
        deadline
    );
    return id;
}
// 功能2：买家付款
function deposit(uint256 id)
    public
    onlyBuyer(id)
    inStatus(id, Status.Created)
{
    Order storage o = _orders[id];

    // 将订单状态改为 Paid
    o.status = Status.Paid;

    // 将买家的代币转入 Escrow 合约
    bool success = IERC20(o.token).transferFrom(
        msg.sender,
        address(this),
        o.amount
    );

    require(
        success,
        "Escrow: token transfer failed"
    );

    // 触发付款事件
    emit OrderPaid(id);
}
// 功能3：确认收货
function confirm(uint256 id)
    public
    onlyBuyer(id)
    inStatus(id, Status.Paid)
{
    Order storage o = _orders[id];

    // 将订单状态改为 Completed
    o.status = Status.Completed;

    // 将代币转给卖家
    bool success = IERC20(o.token).transfer(
        o.seller,
        o.amount
    );

    require(
        success,
        "Escrow: token transfer failed"
    );

    emit OrderCompleted(id);
}


// 功能4：超过截止时间后退款
function refund(uint256 id)
    public
    onlyBuyer(id)
    inStatus(id, Status.Paid)
{
    Order storage o = _orders[id];

    // 检查是否已经超过截止时间
    require(
        block.timestamp > o.deadline,
        "Escrow: deadline not reached"
    );

    // 将订单状态改为 Refunded
    o.status = Status.Refunded;

    // 将代币退还给买家
    bool success = IERC20(o.token).transfer(
        o.buyer,
        o.amount
    );



    require(
        success,
        "Escrow: token transfer failed"
    );

    emit OrderRefunded(id);
}


// 功能5：发起争议
function dispute(uint256 id)
    public
    inStatus(id, Status.Paid)
{
    Order storage o = _orders[id];

    // 只有买家或卖家可以发起争议
    require(
        msg.sender == o.buyer || msg.sender == o.seller,
        "Escrow: caller is not buyer or seller"
    );

    // 将订单状态改为 Disputed
    o.status = Status.Disputed;

    emit OrderDisputed(id, msg.sender);
}


// 功能6：解决争议
function resolve(uint256 id, bool sellerWins)
    public
    onlyArbiter
    inStatus(id, Status.Disputed)
{
    Order storage o = _orders[id];

    if (sellerWins) {

        // 卖家赢得争议
        o.status = Status.Completed;

        bool success = IERC20(o.token).transfer(
            o.seller,
            o.amount
        );

        require(
            success,
            "Escrow: token transfer failed"
        );

    } else {

        // 买家赢得争议
        o.status = Status.Refunded;

        bool success = IERC20(o.token).transfer(
            o.buyer,
            o.amount
        );

        require(
            success,
            "Escrow: token transfer failed"
        );
    }

    emit OrderResolved(id, sellerWins);
}
}
