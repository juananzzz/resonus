// IDiscordRpcService.aidl
package com.discord.socialsdk.rpc;

import com.discord.socialsdk.rpc.IDiscordRpcCallback;
import com.discord.socialsdk.rpc.IDiscordRpcConnection;
/**
 * Service interface for establishing Discord RPC connections.
 */
interface IDiscordRpcService {
    IDiscordRpcConnection connect(long j, String str, IDiscordRpcCallback iDiscordRpcCallback);
}