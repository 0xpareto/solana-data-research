import { PublicKey, Connection } from "@solana/web3.js";
import { getAllTx } from "../utils/misc";
import * as Throttle from "promise-parallel-throttle";

const connection = new Connection(
  "https://ssc-dao.genesysgo.net/",
  "confirmed"
);

let raydiumPool = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");

import * as fs from "fs";

interface Result {
  trxId: string;
  owner: string;
  blockTime: number;
  deltas: any;
}

const dumpTrx = async () => {
  let sigs = await getAllTx(connection, raydiumPool, 10000000, 1000);
  fs.writeFile("data/raydium_trx.json", JSON.stringify(sigs), "utf8", () => {});
};

const analyseTrx = async (trxId: string, index: number) => {
  try {
    if (index % 10000 == 0) {
      console.log("Index: %i", index);
    }
    let parsedTrx = await connection.getParsedTransaction(trxId);

    // Filter any LP reward trx / LP removal
    for (const log of parsedTrx.meta.logMessages) {
      if (log.toString().includes("lp_mint_supply")) {
        //   console.log("Not Arb");
        return undefined;
      }
    }

    let signer = parsedTrx.transaction.message.accountKeys
      .filter((e) => e.signer === true)[0]
      .pubkey.toString();

    let preTokenBalances = parsedTrx.meta.preTokenBalances.filter(
      (e) => e.owner === signer
    );
    let postTokenBalances = parsedTrx.meta.postTokenBalances.filter(
      (e) => e.owner === signer
    );
    if (preTokenBalances.length !== 2 || postTokenBalances.length !== 2) {
      return undefined;
    }
    let deltas = {};

    for (const a of preTokenBalances) {
      let postToken = postTokenBalances.filter((e) => e.mint === a.mint)[0];
      if (postToken.uiTokenAmount.uiAmount <= a.uiTokenAmount.uiAmount) {
        //   console.log("Not Arb");
        return undefined;
      } else {
        deltas[a.mint] = +(
          postToken.uiTokenAmount.uiAmount - a.uiTokenAmount.uiAmount
        ).toPrecision(6);
      }
    }

    let r: Result = {
      trxId: trxId,
      owner: signer,
      blockTime: parsedTrx.blockTime,
      deltas: deltas,
    };

    console.log("Arb Found");
    console.log(trxId);
    console.log(deltas);
    return r;
  } catch (error) {
    console.log(error);
    return undefined;
  }
};

const findArbs = async () => {
  console.time("parsing");
  const data = JSON.parse(fs.readFileSync("data/raydium_trx.json", "utf8"));

  const queue = data.map((e, index) => () => analyseTrx(e.signature, index));
  let results = await Throttle.all(queue, { maxInProgress: 10 });

  results = results.filter((r) => r !== undefined);

  fs.writeFile(
    "data/resultsRPCP.json",
    JSON.stringify(results),
    "utf8",
    () => {}
  );
  console.timeEnd("parsing");
};

dumpTrx();
findArbs();
