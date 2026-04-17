using Fleck;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new RawInputBridgeForm());
    }
}

public class RawInputBridgeForm : Form
{
    private readonly WebSocketServer _server;
    private readonly List<IWebSocketConnection> _clients = new();

    private readonly ConcurrentDictionary<nint, MouseDeviceInfo> _devices = new();
    private readonly Dictionary<string, nint> _playerBindings = new()
    {
        ["p1"] = nint.Zero,
        ["p2"] = nint.Zero
    };

    public RawInputBridgeForm()
    {
        Text = "MouseBridge";
        ShowInTaskbar = true;
        WindowState = FormWindowState.Normal;
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        Opacity = 1;
        Width = 700;
        Height = 400;

        _server = new WebSocketServer("ws://127.0.0.1:8765");
        StartWebSocket();
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        RegisterForRawInput();
        RefreshDeviceList();

        Console.WriteLine("MouseBridge 已啟動");
        Console.WriteLine("WebSocket: ws://127.0.0.1:8765");
        Console.WriteLine("Raw Input 已註冊");
        Console.WriteLine("請保持這個程式開啟，再到瀏覽器綁定 P1 / P2 滑鼠。");
    }

    private void StartWebSocket()
    {
        _server.Start(socket =>
        {
            socket.OnOpen = () =>
            {
                lock (_clients) _clients.Add(socket);
                Console.WriteLine("瀏覽器已連線");
            };

            socket.OnClose = () =>
            {
                lock (_clients) _clients.Remove(socket);
                Console.WriteLine("瀏覽器已斷線");
            };

            socket.OnMessage = msg =>
            {
                try
                {
                    HandleWsMessage(socket, msg);
                }
                catch (Exception ex)
                {
                    Send(socket, new
                    {
                        type = "error",
                        message = ex.Message
                    });
                }
            };
        });
    }

    private void HandleWsMessage(IWebSocketConnection socket, string msg)
    {
        using var doc = JsonDocument.Parse(msg);
        var root = doc.RootElement;

        var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;

        switch (type)
        {
            case "list-devices":
                RefreshDeviceList();
                Send(socket, new
                {
                    type = "devices",
                    devices = _devices.Values
                        .Select(d => new
                        {
                            id = d.Id,
                            name = d.Name
                        })
                        .OrderBy(d => d.name)
                        .ToArray()
                });
                break;

            case "bind-device":
            {
                var playerId = root.GetProperty("playerId").GetString();
                var deviceId = root.GetProperty("deviceId").GetString();

                if (playerId is not ("p1" or "p2"))
                    throw new Exception("playerId 必須是 p1 或 p2");

                var device = _devices.Values.FirstOrDefault(d => d.Id == deviceId);
                if (device == null)
                    throw new Exception("找不到指定裝置");

                _playerBindings[playerId!] = device.Handle;

                Console.WriteLine($"{playerId} 綁定到 {device.Name} | handle={device.Handle}");

                Broadcast(new
                {
                    type = "connected",
                    playerId,
                    deviceId = device.Id,
                    name = device.Name
                });
                break;
            }

            case "unbind-device":
            {
                var playerId = root.GetProperty("playerId").GetString();

                if (playerId is not ("p1" or "p2"))
                    throw new Exception("playerId 必須是 p1 或 p2");

                _playerBindings[playerId!] = nint.Zero;

                Console.WriteLine($"{playerId} 已解除綁定");

                Broadcast(new
                {
                    type = "disconnected",
                    playerId
                });
                break;
            }

            default:
                Console.WriteLine($"未知 WS 訊息: {msg}");
                break;
        }
    }

    protected override void WndProc(ref Message m)
    {
        const int WM_INPUT = 0x00FF;
        const int WM_INPUT_DEVICE_CHANGE = 0x00FE;

        if (m.Msg == WM_INPUT)
        {
            ProcessRawInput(m.LParam);
        }
        else if (m.Msg == WM_INPUT_DEVICE_CHANGE)
        {
            RefreshDeviceList();
        }

        base.WndProc(ref m);
    }

    private void RegisterForRawInput()
    {
        var rid = new RAWINPUTDEVICE[]
        {
            new RAWINPUTDEVICE
            {
                usUsagePage = 0x01,
                usUsage = 0x02, // mouse
                dwFlags = RawInputDeviceFlags.RIDEV_INPUTSINK | RawInputDeviceFlags.RIDEV_DEVNOTIFY,
                hwndTarget = Handle
            }
        };

        if (!RegisterRawInputDevices(rid, (uint)rid.Length, (uint)Marshal.SizeOf<RAWINPUTDEVICE>()))
        {
            throw new Exception("RegisterRawInputDevices 失敗");
        }
    }

    private void RefreshDeviceList()
    {
        uint deviceCount = 0;
        uint dwSize = (uint)Marshal.SizeOf<RAWINPUTDEVICELIST>();

        GetRawInputDeviceList(null, ref deviceCount, dwSize);
        if (deviceCount == 0) return;

        var list = new RAWINPUTDEVICELIST[deviceCount];
        var result = GetRawInputDeviceList(list, ref deviceCount, dwSize);
        if (result == uint.MaxValue) return;

        _devices.Clear();

        foreach (var item in list)
        {
            if (item.dwType != RawInputDeviceType.RIM_TYPEMOUSE)
                continue;

            var name = GetDeviceName(item.hDevice);
            if (string.IsNullOrWhiteSpace(name))
                name = $"Mouse-{item.hDevice}";

            var id = name;

            _devices[item.hDevice] = new MouseDeviceInfo
            {
                Handle = item.hDevice,
                Id = id,
                Name = name
            };
        }

        Console.WriteLine("目前滑鼠裝置：");
        foreach (var d in _devices.Values.OrderBy(x => x.Name))
        {
            Console.WriteLine($"- {d.Name} | handle={d.Handle}");
        }
    }

    private string GetDeviceName(nint deviceHandle)
    {
        uint pcbSize = 0;
        GetRawInputDeviceInfo(deviceHandle, RIDI_DEVICENAME, IntPtr.Zero, ref pcbSize);

        if (pcbSize == 0) return "";

        IntPtr pData = Marshal.AllocHGlobal((int)pcbSize * 2);
        try
        {
            uint res = GetRawInputDeviceInfo(deviceHandle, RIDI_DEVICENAME, pData, ref pcbSize);
            if (res == uint.MaxValue) return "";

            string rawName = Marshal.PtrToStringUni(pData) ?? "";
            return rawName;
        }
        finally
        {
            Marshal.FreeHGlobal(pData);
        }
    }

    private void ProcessRawInput(nint hRawInput)
    {
        uint dwSize = 0;
        uint headerSize = (uint)Marshal.SizeOf<RAWINPUTHEADER>();

        GetRawInputData(hRawInput, RID_INPUT, IntPtr.Zero, ref dwSize, headerSize);
        if (dwSize == 0) return;

        IntPtr buffer = Marshal.AllocHGlobal((int)dwSize);
        try
        {
            uint read = GetRawInputData(hRawInput, RID_INPUT, buffer, ref dwSize, headerSize);
            if (read == 0 || read == uint.MaxValue) return;

            var header = Marshal.PtrToStructure<RAWINPUTHEADER>(buffer);
            if (header.dwType != RawInputDeviceType.RIM_TYPEMOUSE)
                return;

            IntPtr mousePtr = IntPtr.Add(buffer, Marshal.SizeOf<RAWINPUTHEADER>());
            var mouse = Marshal.PtrToStructure<RAWMOUSE>(mousePtr);

            var deviceHandle = header.hDevice;
            var dx = mouse.lLastX;
            var dy = mouse.lLastY;

            Console.WriteLine($"RAW MOVE  handle={deviceHandle} dx={dx} dy={dy}");

            if (dx == 0 && dy == 0)
                return;

            string? playerId = null;

            if (_playerBindings["p1"] == deviceHandle) playerId = "p1";
            else if (_playerBindings["p2"] == deviceHandle) playerId = "p2";

            if (playerId == null)
                return;

            Console.WriteLine($"SEND MOVE {playerId} dx={dx} dy={dy}");

            Broadcast(new
            {
                type = "move",
                playerId,
                dx,
                dy
            });
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private void Send(IWebSocketConnection socket, object payload)
    {
        if (socket.IsAvailable)
        {
            socket.Send(JsonSerializer.Serialize(payload));
        }
    }

    private void Broadcast(object payload)
    {
        var json = JsonSerializer.Serialize(payload);
        lock (_clients)
        {
            foreach (var c in _clients.ToList())
            {
                if (c.IsAvailable)
                    c.Send(json);
            }
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        base.OnFormClosed(e);
        try
        {
            _server.Dispose();
        }
        catch { }
    }

    private class MouseDeviceInfo
    {
        public nint Handle { get; set; }
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
    }

    private const uint RID_INPUT = 0x10000003;
    private const uint RIDI_DEVICENAME = 0x20000007;

    [DllImport("User32.dll", SetLastError = true)]
    private static extern bool RegisterRawInputDevices(
        [In] RAWINPUTDEVICE[] pRawInputDevices,
        uint uiNumDevices,
        uint cbSize);

    [DllImport("User32.dll", SetLastError = true)]
    private static extern uint GetRawInputData(
        nint hRawInput,
        uint uiCommand,
        IntPtr pData,
        ref uint pcbSize,
        uint cbSizeHeader);

    [DllImport("User32.dll", SetLastError = true)]
    private static extern uint GetRawInputDeviceList(
        [In, Out] RAWINPUTDEVICELIST[]? pRawInputDeviceList,
        ref uint puiNumDevices,
        uint cbSize);

    [DllImport("User32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern uint GetRawInputDeviceInfo(
        nint hDevice,
        uint uiCommand,
        IntPtr pData,
        ref uint pcbSize);

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWINPUTDEVICE
    {
        public ushort usUsagePage;
        public ushort usUsage;
        public RawInputDeviceFlags dwFlags;
        public nint hwndTarget;
    }

    [Flags]
    private enum RawInputDeviceFlags : uint
    {
        RIDEV_INPUTSINK = 0x00000100,
        RIDEV_DEVNOTIFY = 0x00002000
    }

    private enum RawInputDeviceType : uint
    {
        RIM_TYPEMOUSE = 0,
        RIM_TYPEKEYBOARD = 1,
        RIM_TYPEHID = 2
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWINPUTDEVICELIST
    {
        public nint hDevice;
        public RawInputDeviceType dwType;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWINPUTHEADER
    {
        public RawInputDeviceType dwType;
        public uint dwSize;
        public nint hDevice;
        public nint wParam;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWMOUSE
    {
        public ushort usFlags;
        public uint ulButtons;
        public ushort usButtonFlags;
        public ushort usButtonData;
        public uint ulRawButtons;
        public int lLastX;
        public int lLastY;
        public uint ulExtraInformation;
    }
}