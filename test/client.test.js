import assert from "assert";
import { TwinClient } from "../src/client.js";
import {
    TwinError,
    TwinAuthError,
    TwinMicropayError,
    TwinMicropayAmountMismatchError,
    TwinMicropayTokenMismatchError } from "../src/error.js";

import * as mock from "./mock.js";
import nock from "nock"

const paywall = {
    url: "https://41d83ecbac7b2a50e451ee2a453fb8f4.tq.biz.todaq.net",
    address: "41d83ecbac7b2a50e451ee2a453fb8f46a32fa071c9fab08f0d597eed3d0e74a0e",
    apiKey: "8c0b7fb3-c832-4c54-9f8f-3a5e8eef4e52",
    config: {
        targetUrl: "https://example.com",
        targetPayType: "41f88b1490292e22ac37a5da7d9cdb88cffda408ae12a188243ad209e6f9fa5ef9",
        targetPayQuantity: 1
    }
};

const payer = {
    url: "https://4112873c42e819316dcfafdddb95a5cf.tq.biz.todaq.net",
    apiKey: "41b95538-b2a5-4aea-9121-a7d4e8558a63"
};

describe("TwinError", async function() {
    it("Should throw TwinError when error is not handled", async function() {
        let url = "https://im-a-teapot.com";
        let mock = nock(url).get("/info").reply(418, { error: "Teapot" });
        try {
            let client = new TwinClient({url});
            await client.info();
        } catch (err) {
            console.error(err)
            assert(err instanceof TwinError);
            assert.deepEqual(err.data, { error: "Teapot" });
        } finally {
            mock.done();
        }
    });
});

describe("TwinAuthError", async function() {
    it("Should throw TwinAuthError when response status is 403", async function() {
        let client = new TwinClient({...payer, apiKey: "definitely-wrong-api-key"});
        try {
            await client.request({ method: "GET", url: "/config" });
        } catch (err) {
            console.error(err)
            assert(err instanceof TwinAuthError);
        }
    });
});

describe("TwinClient.info", async function() {
    it("Should retrieve info", async function() {
        let client = new TwinClient({url: paywall.url});
        let info = await client.info();
        console.log(info);
        assert.equal(info.address, paywall.address);
        assert.deepEqual(info.paywall, paywall.config);
    });
});

describe("TwinClient.fetch", async function() {
    it("Should fetch binary toda file from twin", async function() {
        let client = new TwinClient(payer);
        let info = await client.info();
        let { binderId } = info;
        let binderBinary = await client.fetch(binderId);
        assert(binderBinary.length > 0);
    });
});

describe("TwinClient.import", async function() {
    it("Should handle import file failure", async function() {
        let twinApp = mock.twinApp();
        twinApp = mock.addImportFileError(twinApp);
        let twinApi = await mock.start(twinApp, { port: 8089 });
        let client = new TwinClient({ url: "http://localhost:8089" });
        try {
            await client.import('some-binary-file-content')
        } catch (err) {
            assert(err instanceof TwinError);
            assert.equal(err.message, "Bad Request")
            assert.deepEqual(err.data, {
                error: "Import error string"
            });
        } finally {
            await mock.stop(twinApi);
        }
    });
    it("Should handle import file success", async function() {
        let twinApp = mock.twinApp();
        twinApp = mock.addImportFileSuccess(twinApp);
        let twinApi = await mock.start(twinApp, { port: 8089 });
        let client = new TwinClient({ url: "http://localhost:8089" });
        try {
            let res = await client.import(Buffer.from('some-binary-file-content'));
            assert(res)
        } finally {
            await mock.stop(twinApi);
        }
    });
});

describe("TwinClient.pay", async function() {
    it("Should transfer payment to destination", async function() {
        // NOTE(sfertman): This test transfers from PAYWALL back to the PAYEE twin.
        let client = new TwinClient({url: paywall.url, apiKey: paywall.apiKey});
        let url = payer.url;//.split("://")[1];
        let tokenTypeHash = paywall.config.targetPayType;
        let amount = paywall.config.targetPayQuantity;

        let res = await client.pay(url, tokenTypeHash, amount);
        assert.equal(res.result, "Success");
        await new Promise((res) => setTimeout(() => res(true), 5000));
    });
});

describe("TwinClient.micropay", async function() {
    it("Should throw TwinMicropayAmountMismatchError on wrong amount ", async function() {
        let wrongAmount = 0.1;
        try {
            let client = new TwinClient(payer);
            await client.micropay(paywall.url, paywall.config.targetPayType, wrongAmount)
            assert.fail("Should throw TwinMicropayAmountMismatchError");
        } catch (err) {
            console.error(err);
            assert(err instanceof TwinMicropayAmountMismatchError);
        }
    });
    it("Should throw TwinMicropayTokenMismatchError on wrong token ", async function() {
        let wrongTokenHash = paywall.address; // toda hash but not a token
        try {
            let client = new TwinClient(payer);
            await client.micropay(paywall.url, wrongTokenHash, paywall.config.targetPayQuantity);
            assert.fail("Should throw TwinMicropayTokenMismatchError");
        } catch (err) {
            console.error(err);
            assert(err instanceof TwinMicropayTokenMismatchError);
        }
    });
    it("Should throw TwinMicropayError otherwise" , async function() {
        let payerTwin = await mock.start(
            mock.addMicropayBadRequest(mock.twinApp()),
            { port: 8089 }
        );
        let payer = new TwinClient({ url: "http://localhost:8089" });


        let paywall = {
            url: "http://localhost:8090",
            address: "41mockaddress",
            config: {
                targetPayType: "41mocktokentype",
                targetPayQuantity: 1
            }
        };
        let payeeTwin = await mock.start(
            mock.addInfo(mock.twinApp(), {
                address: paywall.address,
                paywall: {
                    targetPayType: paywall.config.targetPayType,
                    targetPayQuantity: paywall.config.targetPayQuantity,

                 }}),
            { port: 8090 }
        );

        try {
            await payer.micropay("http://localhost:8090", paywall.config.targetPayType, paywall.config.targetPayQuantity);
        } catch(err) {
            assert(err instanceof TwinMicropayError);
            assert.equal(err.message, "Bad Request")
            assert.deepEqual(err.data, { error: "Any bad micropay request" });
        } finally {
            await mock.stop(payerTwin);
            await mock.stop(payeeTwin);
        }
    });
    it("Should micropay the paywall", async function() {
        let client = new TwinClient(payer);
        let res = await client.micropay(paywall.url, paywall.config.targetPayType, paywall.config.targetPayQuantity);
        assert(res);
        await new Promise((res) => setTimeout(() => res(true), 5000));
    });
});
