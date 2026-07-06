export const arxivCategoryLabels: Record<string, string> = {
  "cs.AI": "Artificial Intelligence",
  "cs.AR": "Hardware Architecture",
  "cs.CC": "Computational Complexity",
  "cs.CE": "Computational Engineering, Finance, and Science",
  "cs.CG": "Computational Geometry",
  "cs.CL": "Computation and Language",
  "cs.CR": "Cryptography and Security",
  "cs.CV": "Computer Vision and Pattern Recognition",
  "cs.CY": "Computers and Society",
  "cs.DB": "Databases",
  "cs.DC": "Distributed, Parallel, and Cluster Computing",
  "cs.DL": "Digital Libraries",
  "cs.DM": "Discrete Mathematics",
  "cs.DS": "Data Structures and Algorithms",
  "cs.ET": "Emerging Technologies",
  "cs.FL": "Formal Languages and Automata Theory",
  "cs.GL": "General Literature",
  "cs.GR": "Graphics",
  "cs.GT": "Computer Science and Game Theory",
  "cs.HC": "Human-Computer Interaction",
  "cs.IR": "Information Retrieval",
  "cs.IT": "Information Theory",
  "cs.LG": "Machine Learning",
  "cs.LO": "Logic in Computer Science",
  "cs.MA": "Multiagent Systems",
  "cs.MM": "Multimedia",
  "cs.MS": "Mathematical Software",
  "cs.NA": "Numerical Analysis",
  "cs.NE": "Neural and Evolutionary Computing",
  "cs.NI": "Networking and Internet Architecture",
  "cs.OH": "Other Computer Science",
  "cs.OS": "Operating Systems",
  "cs.PF": "Performance",
  "cs.PL": "Programming Languages",
  "cs.RO": "Robotics",
  "cs.SC": "Symbolic Computation",
  "cs.SD": "Sound",
  "cs.SE": "Software Engineering",
  "cs.SI": "Social and Information Networks",
  "cs.SY": "Systems and Control",
};

export const arxivCategoryDescriptions: Record<string, string> = {
  "cs.AI": "Artificial intelligence, including reasoning, planning, knowledge representation, intelligent agents, and search.",
  "cs.AR": "Computer architecture, including processors, memory systems, accelerators, and hardware/software organization.",
  "cs.CC": "Computational complexity, including complexity classes, reductions, lower bounds, and hardness of computation.",
  "cs.CE": "Computational engineering, finance, and science, including scientific computing and domain-specific computational methods.",
  "cs.CG": "Computational geometry, including geometric algorithms, spatial data structures, and discrete geometry.",
  "cs.CL": "Computation and language, including natural language processing, machine translation, language modeling, and computational linguistics.",
  "cs.CR": "Cryptography and security, including cryptographic protocols, authentication, privacy, systems security, and secure computation.",
  "cs.CV": "Computer vision and pattern recognition, including image recognition, video understanding, visual representation learning, and perception.",
  "cs.CY": "Computers and society, including social impacts, policy, ethics, education, and technology governance.",
  "cs.DB": "Databases, including relational models, query processing, transactions, indexing, storage engines, and data management systems.",
  "cs.DC": "Distributed, parallel, and cluster computing, including distributed systems, consensus, cloud systems, and large-scale data processing.",
  "cs.DL": "Digital libraries, including repositories, metadata, indexing, scholarly information systems, and preservation.",
  "cs.DM": "Discrete mathematics for computer science, including combinatorics, graph theory, and discrete structures.",
  "cs.DS": "Data structures and algorithms, including algorithm design, analysis, data structures, and computational efficiency.",
  "cs.ET": "Emerging technologies, including new computing paradigms, experimental platforms, and novel hardware/software systems.",
  "cs.FL": "Formal languages and automata theory, including automata, grammars, computability, and language theory.",
  "cs.GL": "General literature, including surveys, references, educational material, and broad computer science overviews.",
  "cs.GR": "Computer graphics, including rendering, visualization, geometry processing, animation, and visual computing.",
  "cs.GT": "Computer science and game theory, including algorithmic game theory, auctions, mechanism design, and strategic computation.",
  "cs.HC": "Human-computer interaction, including user interfaces, usability, interaction design, accessibility, and user studies.",
  "cs.IR": "Information retrieval, including search engines, ranking, indexing, recommendation, and retrieval evaluation.",
  "cs.IT": "Information theory, including coding, compression, communication limits, entropy, and information-theoretic methods.",
  "cs.LG": "Machine learning, including statistical learning, neural networks, optimization, representation learning, and generative modeling.",
  "cs.LO": "Logic in computer science, including proof systems, formal verification, model checking, and logical foundations.",
  "cs.MA": "Multiagent systems, including agent coordination, distributed artificial intelligence, negotiation, and autonomous agents.",
  "cs.MM": "Multimedia, including audio, video, images, multimodal systems, media analysis, and content processing.",
  "cs.MS": "Mathematical software, including computer algebra systems, numerical software, and software for mathematical computation.",
  "cs.NA": "Numerical analysis, including numerical algorithms, approximation, simulation, and scientific computation.",
  "cs.NE": "Neural and evolutionary computing, including neural computation, evolutionary algorithms, genetic programming, and adaptive systems.",
  "cs.NI": "Networking and internet architecture, including network protocols, routing, transport, wireless networks, and internet systems.",
  "cs.OH": "Other computer science, including interdisciplinary and miscellaneous computer science topics not covered elsewhere.",
  "cs.OS": "Operating systems, including kernels, Unix, virtual memory, file systems, concurrency, resource management, and system interfaces.",
  "cs.PF": "Performance, including benchmarking, workload characterization, system measurement, profiling, and performance evaluation.",
  "cs.PL": "Programming languages, including semantics, type systems, compilers, runtime systems, and language design.",
  "cs.RO": "Robotics, including robot perception, planning, control, manipulation, navigation, and autonomous systems.",
  "cs.SC": "Symbolic computation, including computer algebra, exact computation, symbolic algorithms, and algebraic manipulation.",
  "cs.SD": "Sound, including audio processing, speech, music information retrieval, and computational sound analysis.",
  "cs.SE": "Software engineering, including software development, testing, maintenance, empirical methods, requirements, and software quality.",
  "cs.SI": "Social and information networks, including network analysis, social graphs, web graphs, diffusion, and network mining.",
  "cs.SY": "Systems and control, including control theory, cyber-physical systems, dynamical systems, and feedback control.",
};

const arxivCategoryPattern = /^cs\.[A-Z]{2}$/;

export function arxivCategoryLabel(category: string | null | undefined) {
  if (!category) {
    return undefined;
  }

  return arxivCategoryLabels[category] ?? category;
}

export function isArxivCategoryCode(value: string | null | undefined) {
  return Boolean(value && arxivCategoryPattern.test(value));
}

export function topicDisplayLabel({
  arxivCategory,
  label,
}: {
  arxivCategory?: string | null;
  label: string;
}) {
  const trimmedLabel = label.trim();
  const categoryCode = arxivCategory ?? (isArxivCategoryCode(trimmedLabel) ? trimmedLabel : null);
  const categoryLabel = arxivCategoryLabel(categoryCode);

  if (categoryLabel && isArxivCategoryCode(trimmedLabel)) {
    return categoryLabel;
  }

  return trimmedLabel || categoryLabel || "Untitled topic";
}
