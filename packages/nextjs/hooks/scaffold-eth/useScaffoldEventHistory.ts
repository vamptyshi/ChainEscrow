import { useEffect } from "react";
import { deduplicateEvents, fetchEventHistoryPage, getNextEventBlock } from "./eventHistoryUtils";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Abi, AbiEvent, ExtractAbiEventNames } from "abitype";
import { BlockNumber, GetLogsParameters } from "viem";
import { hardhat } from "viem/chains";
import { Config, UsePublicClientReturnType, useBlockNumber, usePublicClient } from "wagmi";
import { useSelectedNetwork } from "~~/hooks/scaffold-eth";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { AllowedChainIds } from "~~/utils/scaffold-eth";
import { replacer } from "~~/utils/scaffold-eth/common";
import {
  ContractAbi,
  ContractName,
  UseScaffoldEventHistoryConfig,
  UseScaffoldEventHistoryData,
} from "~~/utils/scaffold-eth/contract";

const getEvents = async (
  getLogsParams: GetLogsParameters<AbiEvent | undefined, AbiEvent[] | undefined, boolean, BlockNumber, BlockNumber>,
  publicClient: NonNullable<UsePublicClientReturnType<Config, number>>,
  Options?: {
    blockData?: boolean;
    transactionData?: boolean;
    receiptData?: boolean;
  },
) => {
  const logs = await publicClient.getLogs({
    address: getLogsParams.address,
    fromBlock: getLogsParams.fromBlock,
    toBlock: getLogsParams.toBlock,
    args: getLogsParams.args,
    event: getLogsParams.event,
  });

  return Promise.all(
    logs.map(async log => ({
      ...log,
      blockData: Options?.blockData && log.blockHash ? await publicClient.getBlock({ blockHash: log.blockHash }) : null,
      transactionData:
        Options?.transactionData && log.transactionHash
          ? await publicClient.getTransaction({ hash: log.transactionHash })
          : null,
      receiptData:
        Options?.receiptData && log.transactionHash
          ? await publicClient.getTransactionReceipt({ hash: log.transactionHash })
          : null,
    })),
  );
};

/**
 * @deprecated **Recommended only for local (hardhat/anvil) chains and development.**
 * It uses getLogs which can overload RPC endpoints (especially on L2s with short block times).
 * For production, use an indexer such as ponder.sh or similar to query contract events efficiently.
 *
 * Reads events from a deployed contract.
 * @param config - The config settings
 * @param config.contractName - deployed contract name
 * @param config.eventName - name of the event to listen for
 * @param config.fromBlock - optional block number to start reading events from (defaults to `deployedOnBlock` in deployedContracts.ts if set for contract, otherwise defaults to 0)
 * @param config.toBlock - optional block number to stop reading events at (if not provided, reads until current block)
 * @param config.chainId - optional chainId that is configured with the scaffold project to make use for multi-chain interactions.
 * @param config.filters - filters to be applied to the event (parameterName: value)
 * @param config.blockData - if set to true it will return the block data for each event (default: false)
 * @param config.transactionData - if set to true it will return the transaction data for each event (default: false)
 * @param config.receiptData - if set to true it will return the receipt data for each event (default: false)
 * @param config.watch - if set to true, the events will be updated every pollingInterval milliseconds set at scaffoldConfig (default: false)
 * @param config.enabled - set this to false to disable the hook from running (default: true)
 * @param config.blocksBatchSize - optional batch size for fetching events. If specified, each batch will contain at most this many blocks (default: 500)
 */
export const useScaffoldEventHistory = <
  TContractName extends ContractName,
  TEventName extends ExtractAbiEventNames<ContractAbi<TContractName>>,
  TBlockData extends boolean = false,
  TTransactionData extends boolean = false,
  TReceiptData extends boolean = false,
>({
  contractName,
  eventName,
  fromBlock,
  toBlock,
  chainId,
  filters,
  blockData,
  transactionData,
  receiptData,
  watch,
  enabled = true,
  blocksBatchSize = 500,
}: UseScaffoldEventHistoryConfig<TContractName, TEventName, TBlockData, TTransactionData, TReceiptData>) => {
  const selectedNetwork = useSelectedNetwork(chainId);

  useEffect(() => {
    if (selectedNetwork.id !== hardhat.id) {
      console.log(
        "⚠️ useScaffoldEventHistory is not optimized for production use. It can overload RPC endpoints (especially on L2s)",
      );
    }
  }, [selectedNetwork.id]);

  const publicClient = usePublicClient({ chainId: selectedNetwork.id });
  const { data: blockNumber } = useBlockNumber({ watch, chainId: selectedNetwork.id });
  const { data: deployedContractData } = useDeployedContractInfo({
    contractName,
    chainId: selectedNetwork.id as AllowedChainIds,
  });

  const event =
    deployedContractData &&
    ((deployedContractData.abi as Abi).find(part => part.type === "event" && part.name === eventName) as AbiEvent);
  const isContractAddressAndClientReady =
    Boolean(deployedContractData?.address) && Boolean(publicClient) && Boolean(event);
  const maxBlock =
    blockNumber === undefined ? undefined : toBlock !== undefined && toBlock < blockNumber ? toBlock : blockNumber;
  const fromBlockValue =
    fromBlock !== undefined
      ? fromBlock
      : BigInt(
          deployedContractData && "deployedOnBlock" in deployedContractData
            ? deployedContractData.deployedOnBlock || 0
            : 0,
        );

  const query = useInfiniteQuery({
    queryKey: [
      "eventHistory",
      {
        version: 2,
        contractName,
        address: deployedContractData?.address,
        eventName,
        fromBlock: fromBlockValue.toString(),
        toBlock: toBlock?.toString(),
        chainId: selectedNetwork.id,
        filters: JSON.stringify(filters, replacer),
        blocksBatchSize: blocksBatchSize.toString(),
        blockData: Boolean(blockData),
        transactionData: Boolean(transactionData),
        receiptData: Boolean(receiptData),
      },
    ],
    queryFn: async ({ pageParam }) => {
      if (!deployedContractData?.address || !publicClient || !event) {
        throw new Error("Contract events are not available yet");
      }
      return fetchEventHistoryPage(pageParam, maxBlock, blocksBatchSize, range =>
        getEvents({ address: deployedContractData.address, event, ...range, args: filters }, publicClient, {
          blockData,
          transactionData,
          receiptData,
        }),
      );
    },
    // Never let getLogs default to "latest" before the current block is known.
    enabled: enabled && isContractAddressAndClientReady && maxBlock !== undefined,
    initialPageParam: fromBlockValue,
    // A partial final batch resumes at its actual end, not a full-batch offset.
    getNextPageParam: lastPage => getNextEventBlock(lastPage, maxBlock),
    select: data => {
      const events = deduplicateEvents(data.pages.flatMap(page => page.events)).reverse() as unknown as
        | UseScaffoldEventHistoryData<TContractName, TEventName, TBlockData, TTransactionData, TReceiptData>
        | undefined;
      return { pages: events, pageParams: data.pageParams };
    },
  });

  // Historical loading and watched gaps share bounded, retryable pages. A failed
  // page remains the next cursor and its error stays visible on the same query.
  useEffect(() => {
    if (
      enabled &&
      isContractAddressAndClientReady &&
      query.status === "success" &&
      query.hasNextPage &&
      !query.isFetching &&
      !query.error
    ) {
      query.fetchNextPage();
    }
  }, [query, enabled, isContractAddressAndClientReady]);

  // Keep the public retry action focused on the failed page rather than
  // re-reading an already loaded history before resuming the watched gap.
  const refetch = (options?: Parameters<typeof query.refetch>[0]) =>
    query.isFetchNextPageError ? query.fetchNextPage(options) : query.refetch(options);

  return {
    data: query.data?.pages || [],
    status: query.status,
    error: query.error,
    isLoading: query.isLoading,
    isFetchingNewEvent: query.isFetchingNextPage,
    refetch,
  };
};
