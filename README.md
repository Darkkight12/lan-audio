# 🎧 LAN Audio — Low-Latency Audio Streaming

**Stream audio between devices over your local network. Watch movies with friends and explore multi-device headphone sharing over Wi-Fi.**

LAN Audio is a low-latency audio streaming project designed to transmit audio between devices connected to the same local network. Built with **Next.js and Electron**, it combines a web-based interface with desktop application capabilities.

## ✨ Features

- 🎵 **LAN Audio Streaming** — Transmit audio between devices over a local network.
- ⚡ **Low-Latency Design** — Designed for responsive audio transmission.
- 🌐 **Local Network Communication** — Use your existing Wi-Fi or Ethernet network.
- 🖥️ **Desktop Application** — Electron-based desktop app support.
- 🎨 **Modern Interface** — Web-based UI powered by Next.js.
- 📦 **Windows Distribution** — Package the application for Windows.
- 🎧 **Multi-Device Listening** — Use compatible receiver devices for shared audio playback.
- 🎬 **Movie Nights with Friends** — Share movie audio so everyone can listen using their own headphones connected to their phones.

## 🎬 Watch Movies with Friends

Want to watch a movie together without disturbing others? LAN Audio aims to make shared listening over a local network possible.

### 🎧 Multiple Headphones, One Movie

- 📱 **Phones as Audio Receivers** — Use compatible phones as audio playback devices.
- 👥 **Watch Together** — Watch a movie on one screen while friends listen on their own devices.
- 🎧 **Individual Headphones** — Each listener can connect headphones to their phone.
- 🌐 **Wi-Fi Audio Sharing** — Send audio over your existing local network.
- 🤫 **Private Listening** — Enjoy movies in hostels, dorms, or shared rooms without relying on loud speakers.

### 🍿 Use Cases

- Movie nights with friends
- Watching films in a hostel or shared room
- Sharing computer audio with multiple listeners
- Group listening sessions
- Watching videos without disturbing people nearby

**How it works:** The computer plays the movie, and audio is streamed over the local network to compatible receiver devices. Each listener connects their headphones to their own phone.

> **Note:** Multi-device playback, synchronization, and lip-sync performance depend on the implemented receiver functionality, network conditions, and device hardware.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| Next.js | Web interface and application framework |
| React | User interface |
| Electron | Desktop application |
| JavaScript | Application logic |
| Node.js | Runtime environment |

## 📋 Requirements

- Windows PC for the desktop build
- Node.js and npm for development
- Wi-Fi or Ethernet local network
- Audio input/output devices
- Compatible receiver devices for multi-device playback

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Darkkight12/lan-audio.git
cd lan-audio
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development server

```bash
npm run dev
```

Open the local URL displayed in your terminal, typically:

```text
http://localhost:3000
```

### 4. Build the application

```bash
npm run build
```

Check `package.json` for the exact build and Electron packaging scripts supported by your current configuration.

## 🖥️ Windows Application

Download available Windows builds from:

**[GitHub Releases](https://github.com/Darkkight12/lan-audio/releases)**

Download the release asset provided for Windows and follow any included installation instructions.

## 🌐 Network Setup

1. Connect the participating devices to the same local network.
2. Start the application on the required devices.
3. Configure the audio input and output using the application interface.
4. Allow the application through Windows Firewall if prompted.
5. Test playback and adjust audio settings if necessary.

A stable 5 GHz Wi-Fi connection or wired Ethernet may help reduce congestion and improve streaming consistency.

## 🔧 Troubleshooting

**Application does not start**
- Check that the required dependencies are installed.
- Review terminal output for errors.
- Verify the Node.js version and project scripts.

**Devices cannot connect**
- Confirm that devices can communicate over the local network.
- Check Windows Firewall and Wi-Fi client isolation settings.
- Verify the configured address and port, if applicable.

**Audio has delays or interruptions**
- Reduce unnecessary network traffic.
- Prefer stable Wi-Fi or Ethernet.
- Check the supported audio buffer and sample-rate settings.

**Movie audio is out of sync**
- Test playback on each receiver device.
- Check network stability and audio buffering.
- Account for differences in audio output latency between phones.

## 🗺️ Roadmap

Potential future improvements:

- [ ] Further latency optimization
- [ ] Improved connection and device discovery
- [ ] Audio quality and buffer configuration
- [ ] Better connection status and diagnostics
- [ ] Improved multi-device synchronization
- [ ] Cross-platform desktop support

## 🤝 Contributing

Contributions, bug reports, and feature suggestions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Commit your changes.
4. Open a pull request.

## 📄 License

Add your chosen open-source license to the repository before distributing the project under its terms.

## 👨‍💻 Author

**Albert Biju**

- GitHub: [@Darkkight12](https://github.com/Darkkight12)

---

⭐ If you find this project useful, consider starring the repository!

