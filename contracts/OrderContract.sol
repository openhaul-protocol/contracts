// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ReputationContract.sol";
import "./DisputeContract.sol";

/**
 * @title OrderContract
 * @dev Full order lifecycle management with USDT automatic settlement
 * for OpenHaul Protocol - decentralized logistics marketplace
 */
contract OrderContract is Ownable, ReentrancyGuard {
    
    IERC20 public usdt;
    ReputationContract public reputationContract;
    DisputeContract public disputeContract;
    
    // Order states
    enum OrderStatus {
        None,
        Created,        // Order created, awaiting carrier
        Accepted,       // Carrier accepted
        InTransit,      // Goods in transit
        Delivered,      // Delivered, awaiting confirmation
        Confirmed,      // Delivery confirmed
        Disputed,       // Under dispute
        Resolved,       // Dispute resolved
        Cancelled,      // Cancelled
        Completed       // Fully settled
    }
    
    // Order struct
    struct Order {
        uint256 orderId;
        address shipper;
        address carrier;
        string pickupLocation;
        string deliveryLocation;
        string cargoDetails;
        uint256 cargoValue;
        uint256 shippingFee;
        uint256 collateral;         // Carrier collateral
        uint256 createdAt;
        uint256 acceptedAt;
        uint256 deliveredAt;
        uint256 confirmedAt;
        OrderStatus status;
        bool shipperRated;
        bool carrierRated;
    }
    
    // Platform fees
    uint256 public constant PLATFORM_FEE_BPS = 250; // 2.5%
    uint256 public constant CARRIER_COLLATERAL_BPS = 5000; // 50% of fee
    uint256 public constant BPS_DENOMINATOR = 10000;
    
    // Time constants
    uint256 public constant ACCEPTANCE_WINDOW = 24 hours;
    uint256 public constant DELIVERY_TIMEOUT = 7 days;
    uint256 public constant CONFIRMATION_WINDOW = 3 days;
    
    // State variables
    uint256 public nextOrderId;
    mapping(uint256 => Order) public orders;
    mapping(address => uint256[]) public shipperOrders;
    mapping(address => uint256[]) public carrierOrders;
    mapping(uint256 => uint256) public disputeIdByOrder;
    
    uint256 public totalPlatformFees;
    address public treasury;
    
    // Events
    event OrderCreated(
        uint256 indexed orderId,
        address indexed shipper,
        uint256 shippingFee
    );
    event OrderAccepted(
        uint256 indexed orderId,
        address indexed carrier,
        uint256 collateral
    );
    event OrderInTransit(uint256 indexed orderId);
    event OrderDelivered(uint256 indexed orderId);
    event OrderConfirmed(
        uint256 indexed orderId,
        address indexed confirmer
    );
    event OrderCompleted(
        uint256 indexed orderId,
        uint256 carrierPayout,
        uint256 platformFee
    );
    event OrderCancelled(uint256 indexed orderId, string reason);
    event OrderDisputed(
        uint256 indexed orderId,
        uint256 indexed disputeId
    );
    event CarrierPayout(uint256 indexed orderId, uint256 amount);
    event ShipperRefund(uint256 indexed orderId, uint256 amount);
    
    modifier onlyShipper(uint256 _orderId) {
        require(
            orders[_orderId].shipper == msg.sender,
            "Not the shipper"
        );
        _;
    }
    
    modifier onlyCarrier(uint256 _orderId) {
        require(
            orders[_orderId].carrier == msg.sender,
            "Not the carrier"
        );
        _;
    }
    
    modifier validOrder(uint256 _orderId) {
        require(_orderId < nextOrderId, "Invalid order ID");
        _;
    }
    
    constructor(
        address _usdt,
        address _reputationContract,
        address _disputeContract,
        address _treasury
    ) Ownable(msg.sender) {
        usdt = IERC20(_usdt);
        reputationContract = ReputationContract(_reputationContract);
        disputeContract = DisputeContract(_disputeContract);
        treasury = _treasury;
    }
    
    /**
     * @dev Create a new shipping order
     */
    function createOrder(
        string calldata _pickupLocation,
        string calldata _deliveryLocation,
        string calldata _cargoDetails,
        uint256 _cargoValue,
        uint256 _shippingFee
    ) external nonReentrant returns (uint256) {
        require(_shippingFee > 0, "Shipping fee must be positive");
        require(_cargoValue > 0, "Cargo value must be positive");
        
        uint256 orderId = nextOrderId++;
        
        // Transfer USDT from shipper (fee + collateral buffer)
        uint256 totalRequired = _shippingFee + (_shippingFee * CARRIER_COLLATERAL_BPS / BPS_DENOMINATOR);
        require(
            usdt.transferFrom(msg.sender, address(this), totalRequired),
            "USDT transfer failed"
        );
        
        orders[orderId] = Order({
            orderId: orderId,
            shipper: msg.sender,
            carrier: address(0),
            pickupLocation: _pickupLocation,
            deliveryLocation: _deliveryLocation,
            cargoDetails: _cargoDetails,
            cargoValue: _cargoValue,
            shippingFee: _shippingFee,
            collateral: 0,
            createdAt: block.timestamp,
            acceptedAt: 0,
            deliveredAt: 0,
            confirmedAt: 0,
            status: OrderStatus.Created,
            shipperRated: false,
            carrierRated: false
        });
        
        shipperOrders[msg.sender].push(orderId);
        
        emit OrderCreated(orderId, msg.sender, _shippingFee);
        return orderId;
    }
    
    /**
     * @dev Carrier accepts an order
     */
    function acceptOrder(
        uint256 _orderId
    ) external validOrder(_orderId) nonReentrant {
        Order storage order = orders[_orderId];
        require(order.status == OrderStatus.Created, "Order not available");
        require(
            block.timestamp <= order.createdAt + ACCEPTANCE_WINDOW,
            "Acceptance window expired"
        );
        require(order.shipper != msg.sender, "Cannot accept own order");
        
        // Check carrier reputation
        require(
            reputationContract.meetsThreshold(msg.sender, 100),
            "Insufficient reputation"
        );
        
        uint256 collateral = order.shippingFee * CARRIER_COLLATERAL_BPS / BPS_DENOMINATOR;
        
        // Transfer collateral from carrier
        require(
            usdt.transferFrom(msg.sender, address(this), collateral),
            "Collateral transfer failed"
        );
        
        order.carrier = msg.sender;
        order.collateral = collateral;
        order.acceptedAt = block.timestamp;
        order.status = OrderStatus.Accepted;
        
        carrierOrders[msg.sender].push(_orderId);
        
        emit OrderAccepted(_orderId, msg.sender, collateral);
    }
    
    /**
     * @dev Carrier marks order as in transit
     */
    function startTransit(
        uint256 _orderId
    ) external validOrder(_orderId) onlyCarrier(_orderId) {
        Order storage order = orders[_orderId];
        require(order.status == OrderStatus.Accepted, "Order not accepted");
        
        order.status = OrderStatus.InTransit;
        emit OrderInTransit(_orderId);
    }
    
    /**
     * @dev Carrier marks order as delivered
     */
    function markDelivered(
        uint256 _orderId
    ) external validOrder(_orderId) onlyCarrier(_orderId) {
        Order storage order = orders[_orderId];
        require(order.status == OrderStatus.InTransit, "Order not in transit");
        require(
            block.timestamp <= order.acceptedAt + DELIVERY_TIMEOUT,
            "Delivery timeout"
        );
        
        order.deliveredAt = block.timestamp;
        order.status = OrderStatus.Delivered;
        emit OrderDelivered(_orderId);
    }
    
    /**
     * @dev Shipper confirms delivery
     */
    function confirmDelivery(
        uint256 _orderId
    ) external validOrder(_orderId) onlyShipper(_orderId) {
        Order storage order = orders[_orderId];
        require(order.status == OrderStatus.Delivered, "Order not delivered");
        require(
            block.timestamp <= order.deliveredAt + CONFIRMATION_WINDOW,
            "Confirmation window expired"
        );
        
        order.confirmedAt = block.timestamp;
        order.status = OrderStatus.Confirmed;
        
        emit OrderConfirmed(_orderId, msg.sender);
        
        // Auto-settle
        _settleOrder(_orderId);
    }
    
    /**
     * @dev Auto-confirm if shipper doesn't respond
     */
    function autoConfirm(
        uint256 _orderId
    ) external validOrder(_orderId) {
        Order storage order = orders[_orderId];
        require(order.status == OrderStatus.Delivered, "Order not delivered");
        require(
            block.timestamp > order.deliveredAt + CONFIRMATION_WINDOW,
            "Confirmation window not expired"
        );
        
        order.confirmedAt = block.timestamp;
        order.status = OrderStatus.Confirmed;
        
        emit OrderConfirmed(_orderId, address(0));
        
        // Auto-settle
        _settleOrder(_orderId);
    }
    
    /**
     * @dev Internal settlement function
     */
    function _settleOrder(uint256 _orderId) internal {
        Order storage order = orders[_orderId];
        require(order.status == OrderStatus.Confirmed, "Order not confirmed");
        
        uint256 platformFee = order.shippingFee * PLATFORM_FEE_BPS / BPS_DENOMINATOR;
        uint256 carrierPayout = order.shippingFee - platformFee;
        
        totalPlatformFees += platformFee;
        
        // Pay carrier (fee + return collateral)
        uint256 carrierTotal = carrierPayout + order.collateral;
        require(
            usdt.transfer(order.carrier, carrierTotal),
            "Carrier payout failed"
        );
        
        // Pay platform fee to treasury
        require(
            usdt.transfer(treasury, platformFee),
            "Platform fee transfer failed"
        );
        
        order.status = OrderStatus.Completed;
        
        // Update reputation
        reputationContract.recordCompletion(order.shipper);
        reputationContract.recordCompletion(order.carrier);
        
        emit OrderCompleted(_orderId, carrierPayout, platformFee);
        emit CarrierPayout(_orderId, carrierTotal);
    }
    
    /**
     * @dev Shipper cancels order before acceptance
     */
    function cancelOrder(
        uint256 _orderId
    ) external validOrder(_orderId) onlyShipper(_orderId) nonReentrant {
        Order storage order = orders[_orderId];
        require(
            order.status == OrderStatus.Created,
            "Order cannot be cancelled"
        );
        
        uint256 refund = order.shippingFee + (order.shippingFee * CARRIER_COLLATERAL_BPS / BPS_DENOMINATOR);
        
        order.status = OrderStatus.Cancelled;
        
        require(usdt.transfer(order.shipper, refund), "Refund failed");
        
        emit OrderCancelled(_orderId, "Shipper cancelled");
        emit ShipperRefund(_orderId, refund);
    }
    
    /**
     * @dev Raise dispute
     */
    function raiseDispute(
        uint256 _orderId,
        string calldata _reason
    ) external validOrder(_orderId) nonReentrant {
        Order storage order = orders[_orderId];
        require(
            order.status == OrderStatus.Delivered ||
            order.status == OrderStatus.InTransit,
            "Order not disputable"
        );
        require(
            msg.sender == order.shipper || msg.sender == order.carrier,
            "Not a party"
        );
        
        address respondent = msg.sender == order.shipper ? order.carrier : order.shipper;
        
        uint256 disputeId = disputeContract.createDispute{value: 0}(
            _orderId,
            respondent,
            _reason,
            order.shippingFee + order.collateral
        );
        
        disputeIdByOrder[_orderId] = disputeId;
        order.status = OrderStatus.Disputed;
        
        emit OrderDisputed(_orderId, disputeId);
    }
    
    /**
     * @dev Execute dispute ruling
     */
    function executeDisputeRuling(
        uint256 _orderId
    ) external validOrder(_orderId) nonReentrant {
        Order storage order = orders[_orderId];
        require(order.status == OrderStatus.Disputed, "Order not disputed");
        
        uint256 disputeId = disputeIdByOrder[_orderId];
        DisputeContract.Dispute memory dispute = disputeContract.getDispute(disputeId);
        require(
            dispute.state == DisputeContract.DisputeState.Executed,
            "Dispute not resolved"
        );
        
        order.status = OrderStatus.Resolved;
        
        if (dispute.finalRuling == DisputeContract.Ruling.ShippingPartyWins) {
            // Shipper wins - refund shipping fee + collateral
            uint256 refund = order.shippingFee + order.collateral;
            require(usdt.transfer(order.shipper, refund), "Refund failed");
            emit ShipperRefund(_orderId, refund);
        } else if (dispute.finalRuling == DisputeContract.Ruling.CarryingPartyWins) {
            // Carrier wins - normal settlement
            _settleOrder(_orderId);
        } else {
            // Refused to rule - split 50/50
            uint256 split = (order.shippingFee + order.collateral) / 2;
            require(usdt.transfer(order.shipper, split), "Shipper split failed");
            require(usdt.transfer(order.carrier, split), "Carrier split failed");
        }
    }
    
    /**
     * @dev Rate counterparty after order completion
     */
    function rateCounterparty(
        uint256 _orderId,
        bool _isPositive
    ) external validOrder(_orderId) {
        Order storage order = orders[_orderId];
        require(
            order.status == OrderStatus.Completed ||
            order.status == OrderStatus.Resolved,
            "Order not finished"
        );
        
        if (msg.sender == order.shipper && !order.shipperRated) {
            reputationContract.submitRating(order.carrier, _isPositive, _orderId);
            order.shipperRated = true;
        } else if (msg.sender == order.carrier && !order.carrierRated) {
            reputationContract.submitRating(order.shipper, _isPositive, _orderId);
            order.carrierRated = true;
        } else {
            revert("Not authorized or already rated");
        }
    }
    
    /**
     * @dev Get order details
     */
    function getOrder(
        uint256 _orderId
    ) external view returns (Order memory) {
        return orders[_orderId];
    }
    
    /**
     * @dev Get shipper's orders
     */
    function getShipperOrders(
        address _shipper
    ) external view returns (uint256[] memory) {
        return shipperOrders[_shipper];
    }
    
    /**
     * @dev Get carrier's orders
     */
    function getCarrierOrders(
        address _carrier
    ) external view returns (uint256[] memory) {
        return carrierOrders[_carrier];
    }
    
    /**
     * @dev Update treasury address
     */
    function updateTreasury(address _newTreasury) external onlyOwner {
        treasury = _newTreasury;
    }
    
    /**
     * @dev Withdraw accumulated platform fees (emergency only)
     */
    function withdrawPlatformFees() external onlyOwner {
        uint256 amount = totalPlatformFees;
        totalPlatformFees = 0;
        require(usdt.transfer(treasury, amount), "Withdraw failed");
    }
}
