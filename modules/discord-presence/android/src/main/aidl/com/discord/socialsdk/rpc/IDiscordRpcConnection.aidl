package com.discord.socialsdk.rpc;

interface IDiscordRpcConnection {
    /*
     * Send a JSON frame via the Discord RPC connection.
     * Transcation ID: 1
     */
    void sendFrame(String str);
    /*
     * Interrupt the RPC connection.
     * Transcation ID: 2
     */
    void disconnect();
}